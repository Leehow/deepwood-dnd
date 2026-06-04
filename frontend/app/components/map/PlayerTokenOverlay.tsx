/**
 * PlayerTokenOverlay Component
 * Renders the player's own token above the fog of war
 * Only displays when the token is actually covered by fog
 */

import { useMemo } from "react";
import type { Token, Position } from "./types/TacticalMapTypes";
import { GRID_SIZE } from "./types/TacticalMapTypes";
import { parseTokenSize } from "./utils/mapCalculations";
import type { FogData } from "./FogOfWarManager";

interface PlayerTokenOverlayProps {
  isDM: boolean;
  showFogOfWar: boolean;
  tokens: Token[];
  selectedCharacterId?: number | null;
  userId?: string;
  stageScale: number;
  stagePos: Position;
  fogData?: FogData | null;
}

// 检查token是否被迷雾覆盖（检查token占据的任意一个格子）
function isTokenCoveredByFog(
  token: Token,
  fogCells: Set<string>,
  tokenSize: { width: number; height: number }
): boolean {
  // 检查token占据的所有格子，只要有一个被迷雾覆盖就认为被覆盖
  for (let dx = 0; dx < tokenSize.width; dx++) {
    for (let dy = 0; dy < tokenSize.height; dy++) {
      const gridX = Math.floor(token.position_x) + dx;
      const gridY = Math.floor(token.position_y) + dy;
      if (fogCells.has(`${gridX},${gridY}`)) {
        return true;
      }
    }
  }
  return false;
}

export function PlayerTokenOverlay({
  isDM,
  showFogOfWar,
  tokens,
  selectedCharacterId,
  userId,
  stageScale,
  stagePos,
  fogData,
}: PlayerTokenOverlayProps) {
  // 查找玩家自己的角色token (不包括物品token)
  const myToken = useMemo(() => {
    if (isDM || !showFogOfWar) return null;
    return tokens.find(t =>
      t.character_id &&
      ((selectedCharacterId && t.character_id === selectedCharacterId) ||
      (userId && t.user_id === userId))
    ) || null;
  }, [tokens, selectedCharacterId, userId, isDM, showFogOfWar]);

  // 构建迷雾格子集合
  const fogCells = useMemo(() => {
    const next = new Set<string>();
    if (fogData?.cells) {
      fogData.cells.forEach(([x, y]) => next.add(`${x},${y}`));
    }
    return next;
  }, [fogData]);

  if (!myToken) return null;

  const tokenSize = parseTokenSize(myToken.token_size);

  // 只有当token被迷雾覆盖时才显示overlay
  // 如果不被迷雾覆盖，canvas中的token已经可见，不需要overlay
  if (!isTokenCoveredByFog(myToken, fogCells, tokenSize)) {
    return null;
  }

  const tokenX = myToken.position_x * GRID_SIZE;
  const tokenY = myToken.position_y * GRID_SIZE;
  const tokenWidth = tokenSize.width * GRID_SIZE;
  const tokenHeight = tokenSize.height * GRID_SIZE;

  const displayName = myToken.instance_name || myToken.character_name || myToken.monster_name || "未命名";

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        pointerEvents: "none",
        zIndex: 101, // 在迷雾之上
        transform: `translate(${stagePos.x + tokenX * stageScale}px, ${stagePos.y + tokenY * stageScale}px) scale(${stageScale})`,
        transformOrigin: "0 0",
      }}
    >
      {/* Token头像 - 迷雾中只显示头像，不显示名字和HP */}
      {myToken.avatar ? (
        <img
          src={myToken.avatar}
          alt={displayName}
          style={{
            width: `${tokenWidth}px`,
            height: `${tokenHeight}px`,
            borderRadius: tokenSize.width === 1 && tokenSize.height === 1 ? "50%" : "8px",
            border: "2px solid #ffffff",
            boxShadow: "0 0 10px rgba(0, 0, 0, 0.6)",
          }}
        />
      ) : (
        <div
          style={{
            width: `${tokenWidth}px`,
            height: `${tokenHeight}px`,
            backgroundColor: "#3b82f6",
            borderRadius: tokenSize.width === 1 && tokenSize.height === 1 ? "50%" : "8px",
            border: "2px solid #ffffff",
            boxShadow: "0 0 10px rgba(0, 0, 0, 0.6)",
          }}
        />
      )}
    </div>
  );
}
