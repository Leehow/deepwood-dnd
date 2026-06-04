import type { Token } from "../types/TacticalMapTypes";
import { getEdgeToEdgeDistance, parseTokenSize } from "./mapCalculations";

export function findTokenOccupyingGrid(args: {
  tokens: Token[];
  sourceTokenId?: number;
  gridX: number;
  gridY: number;
}) {
  const { tokens, sourceTokenId, gridX, gridY } = args;
  return tokens.find((token) => {
    if (!token || token.id === sourceTokenId) return false;
    const [rawWidth, rawHeight] = String(token.token_size || "1x1").split("x");
    const width = parseInt(rawWidth, 10) || 1;
    const height = parseInt(rawHeight, 10) || parseInt(rawWidth, 10) || 1;
    return (
      gridX >= token.position_x
      && gridX < token.position_x + width
      && gridY >= token.position_y
      && gridY < token.position_y + height
    );
  });
}

export function getWeaponAttackDistanceFeet(args: {
  sourceToken: Token;
  targetToken: Token;
  gridUnitLength: number;
}) {
  const { sourceToken, targetToken, gridUnitLength } = args;
  const sourceSize = parseTokenSize(sourceToken.token_size);
  const targetSize = parseTokenSize(targetToken.token_size);
  return getEdgeToEdgeDistance(
    sourceToken.position_x,
    sourceToken.position_y,
    sourceSize.width,
    sourceSize.height,
    targetToken.position_x,
    targetToken.position_y,
    targetSize.width,
    targetSize.height,
  ) * gridUnitLength;
}
