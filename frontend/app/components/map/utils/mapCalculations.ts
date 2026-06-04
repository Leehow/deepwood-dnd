/**
 * Utility functions for map calculations
 */

import type { Token, TokenSize, Position } from "../types/TacticalMapTypes";
import { GRID_SIZE } from "../types/TacticalMapTypes";
import { createLogger } from '~/utils/logger';
const logger = createLogger('mapCalculations');


/**
 * Calculate Euclidean distance between two points (for visual/pixel calculations)
 */
export const getDistance = (p1: Position, p2: Position): number => {
  return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
};

/**
 * Calculate D&D 5E grid distance (Chebyshev distance)
 * In D&D grid rules, diagonal adjacent squares count as 5ft (same as orthogonal)
 */
export const getDndGridDistance = (dx: number, dy: number): number => {
  return Math.max(Math.abs(dx), Math.abs(dy));
};

/**
 * Calculate D&D 5E edge-to-edge grid distance between two tokens.
 * Measures Chebyshev distance between nearest occupied cells.
 * position_x/y = top-left grid coordinate, size = {width, height} in grid cells.
 */
export const getEdgeToEdgeDistance = (
  sx: number, sy: number, sw: number, sh: number,
  tx: number, ty: number, tw: number, th: number,
): number => {
  // Clamp dimensions to minimum 1 grid cell (sub-cell tokens like 0.5x0.5 items still occupy 1 cell for distance)
  const ew = Math.max(sw, 1), eh = Math.max(sh, 1);
  const etw = Math.max(tw, 1), eth = Math.max(th, 1);
  // Chebyshev distance between nearest occupied cells in each axis
  // Source occupies x: [sx, sx+ew-1], Target occupies x: [tx, tx+etw-1]
  const minDx = Math.max(0, tx - (sx + ew - 1), sx - (tx + etw - 1));
  const minDy = Math.max(0, ty - (sy + eh - 1), sy - (ty + eth - 1));
  return Math.max(minDx, minDy);
};

/**
 * Calculate center point between two points
 */
export const getCenter = (p1: Position, p2: Position): Position => {
  return {
    x: (p1.x + p2.x) / 2,
    y: (p1.y + p2.y) / 2,
  };
};

/**
 * Parse token size string (e.g., "2x3") into dimensions
 */
export const parseTokenSize = (size?: string): TokenSize => {
  if (!size) return { width: 1, height: 1 };
  const parts = size.split('x');
  if (parts.length !== 2) return { width: 1, height: 1 };
  const w = parseFloat(parts[0]);
  const h = parseFloat(parts[1]);
  return {
    width: isNaN(w) ? 1 : w,
    height: isNaN(h) ? 1 : h,
  };
};

/**
 * Convert D&D creature size category to token grid size
 * D&D 5E size categories: Tiny, Small, Medium, Large, Huge, Gargantuan
 */
export const dndSizeToTokenSize = (size?: string): string => {
  if (!size) return "1x1";
  const normalized = size.toLowerCase().trim();
  // Support both English and Chinese size names
  switch (normalized) {
    case 'tiny':
    case '超小型':
    case '微型':
      return "0.4x0.4";
    case 'small':
    case '小型':
      return "0.65x0.65";
    case 'medium':
    case '中型':
      return "1x1";
    case 'large':
    case '大型':
      return "2x2";
    case 'huge':
    case '巨型':
      return "3x3";
    case 'gargantuan':
    case '超巨型':
      return "4x4";
    default:
      return "1x1";
  }
};

/**
 * Get player's token position (for fog of war rendering)
 */
export const getMyTokenPosition = (
  tokens: Token[],
  selectedCharacterId?: number,
  userId?: string,
  isDM?: boolean
): { x: number; y: number; width: number; height: number } | null => {
  if (isDM) return null; // DM不需要此功能

  let myToken: Token | undefined;

  // 优先通过 selectedCharacterId 查找
  if (selectedCharacterId) {
    myToken = tokens.find(t => t.character_id === selectedCharacterId);
  }

  // 如果没找到，尝试通过 userId 查找
  if (!myToken && userId) {
    myToken = tokens.find(t => t.user_id === userId);
  }

  if (!myToken) return null;

  const tokenSize = parseTokenSize(myToken.token_size);

  return {
    x: myToken.position_x,
    y: myToken.position_y,
    width: tokenSize.width,
    height: tokenSize.height,
  };
};

/**
 * Focus camera on user's token
 */
export const focusMyToken = (
  tokens: Token[],
  stageSize: { width: number; height: number },
  stageScale: number,
  setStagePos: (pos: Position) => void,
  userId?: string,
  selectedCharacterId?: number
): void => {
  let myToken: Token | undefined;

  // 优先通过 selectedCharacterId 查找
  if (selectedCharacterId) {
    myToken = tokens.find(t => t.character_id === selectedCharacterId);
    if (myToken) {
      logger.debug("[MapCalculations] Found token by character_id:", selectedCharacterId);
    }
  }

  // 如果没找到，尝试通过 userId 查找
  if (!myToken && userId) {
    myToken = tokens.find(t => t.user_id === userId);
    if (myToken) {
      logger.debug("[MapCalculations] Found token by user_id:", userId);
    }
  }

  if (!myToken) {
    logger.debug("[MapCalculations] No token found for current user/character");
    alert("你还没有在地图上放置 Token");
    return;
  }

  const tokenSize = parseTokenSize(myToken.token_size);

  // 计算 token 中心在 canvas 上的位置
  const tokenX = myToken.position_x * GRID_SIZE + (Math.max(tokenSize.width, 1) * GRID_SIZE) / 2;
  const tokenY = myToken.position_y * GRID_SIZE + (Math.max(tokenSize.height, 1) * GRID_SIZE) / 2;

  // 将 token 移动到视口中心
  const newX = stageSize.width / 2 - tokenX * stageScale;
  const newY = stageSize.height / 2 - tokenY * stageScale;

  setStagePos({ x: newX, y: newY });
  logger.debug("[MapCalculations] Focused on token:", myToken.character_name, "at", myToken.position_x, myToken.position_y);
};

/**
 * Focus camera on any token by ID and position
 */
export const focusToken = (
  tokenId: number,
  position: Position,
  stageSize: { width: number; height: number },
  stageScale: number,
  setStagePos: (pos: Position) => void
): void => {
  // 默认1x1大小
  const tokenSize = { width: 1, height: 1 };

  // 计算 token 中心在 canvas 上的位置
  const tokenX = position.x * GRID_SIZE + (tokenSize.width * GRID_SIZE) / 2;
  const tokenY = position.y * GRID_SIZE + (tokenSize.height * GRID_SIZE) / 2;

  // 将 token 移动到视口中心
  const newX = stageSize.width / 2 - tokenX * stageScale;
  const newY = stageSize.height / 2 - tokenY * stageScale;

  setStagePos({ x: newX, y: newY });
  logger.debug("[MapCalculations] Focused on token:", tokenId, "at", position.x, position.y);
};

/**
 * Calculate the visible viewport bounds in map (canvas) coordinates.
 * Used for viewport culling — only render objects within these bounds.
 * Returns pixel bounds with an optional padding (in grid cells).
 */
export const getViewportBounds = (
  stagePos: Position,
  stageSize: { width: number; height: number },
  stageScale: number,
  paddingCells: number = 2
): { left: number; top: number; right: number; bottom: number } => {
  const pad = paddingCells * GRID_SIZE;
  return {
    left: -stagePos.x / stageScale - pad,
    top: -stagePos.y / stageScale - pad,
    right: (-stagePos.x + stageSize.width) / stageScale + pad,
    bottom: (-stagePos.y + stageSize.height) / stageScale + pad,
  };
};

/**
 * Check if a token (by grid position + size) is within the viewport bounds.
 * Bounds are in canvas pixel coordinates.
 */
export const isTokenInViewport = (
  token: { position_x: number; position_y: number; token_size?: string },
  bounds: { left: number; top: number; right: number; bottom: number }
): boolean => {
  const size = parseTokenSize(token.token_size);
  const px = token.position_x * GRID_SIZE;
  const py = token.position_y * GRID_SIZE;
  const pw = size.width * GRID_SIZE;
  const ph = size.height * GRID_SIZE;
  return px + pw >= bounds.left && px <= bounds.right
      && py + ph >= bounds.top  && py <= bounds.bottom;
};

/**
 * Calculate grid position at viewport center
 * 计算当前视口中心对应的地图格子坐标
 */
export const getViewportCenterGridPosition = (
  stagePos: Position,
  stageSize: { width: number; height: number },
  stageScale: number
): { x: number; y: number } => {
  // 视口中心的屏幕坐标
  const viewportCenterX = stageSize.width / 2;
  const viewportCenterY = stageSize.height / 2;

  // 转换为地图坐标（像素）
  const mapX = (viewportCenterX - stagePos.x) / stageScale;
  const mapY = (viewportCenterY - stagePos.y) / stageScale;

  // 转换为格子坐标
  const gridX = Math.floor(mapX / GRID_SIZE);
  const gridY = Math.floor(mapY / GRID_SIZE);

  return { x: gridX, y: gridY };
};
