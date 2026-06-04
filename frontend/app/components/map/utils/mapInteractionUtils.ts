import type { Position, Token } from "../types/TacticalMapTypes";
import { dndSizeToTokenSize, parseTokenSize } from "./mapCalculations";

export function getGridCoordinatesFromClientPoint(args: {
  clientX: number;
  clientY: number;
  containerRect: DOMRect | Pick<DOMRect, "left" | "top">;
  stagePos: Position;
  stageScale: number;
  gridSize: number;
}) {
  const { clientX, clientY, containerRect, stagePos, stageScale, gridSize } = args;
  const localX = clientX - containerRect.left;
  const localY = clientY - containerRect.top;
  const mapX = (localX - stagePos.x) / stageScale;
  const mapY = (localY - stagePos.y) / stageScale;

  return {
    gridX: Math.floor(mapX / gridSize),
    gridY: Math.floor(mapY / gridSize),
    localX,
    localY,
    mapX,
    mapY,
  };
}

export function findTokenAtGrid(tokens: Token[], gridX: number, gridY: number): Token | null {
  return (
    tokens.find((token) => {
      const effectiveSize = token.transformation_data?.size
        ? dndSizeToTokenSize(token.transformation_data.size)
        : token.token_size;
      const tokenSize = parseTokenSize(effectiveSize);
      const tokenX = Math.floor(token.position_x);
      const tokenY = Math.floor(token.position_y);

      return (
        gridX >= tokenX &&
        gridX < tokenX + tokenSize.width &&
        gridY >= tokenY &&
        gridY < tokenY + tokenSize.height
      );
    }) || null
  );
}

export function resolvePlayerContextSourceToken(args: {
  tokens: Token[];
  selectedCharacterId?: number | null;
  userId?: string;
  clickedToken: Token | null;
  controlledCharacterIds: Set<number>;
}) {
  const { tokens, selectedCharacterId, userId, clickedToken, controlledCharacterIds } = args;
  const myToken =
    tokens.find(
      (token) =>
        token.character_id &&
        ((selectedCharacterId && token.character_id === selectedCharacterId) ||
          (userId && token.user_id === userId)),
    ) || null;

  const controlledSourceToken =
    clickedToken?.monster_instance_id &&
    clickedToken.control_type &&
    clickedToken.controller_character_id &&
    controlledCharacterIds.has(clickedToken.controller_character_id)
      ? clickedToken
      : null;

  return {
    controlledSourceToken,
    myToken,
    sourceTokenForMenu: controlledSourceToken || myToken,
  };
}

export function isPlayerContextMenuBlockedByTurn(args: {
  sourceToken: Token | null;
  combatIsActive: boolean;
  participantTokenIds?: number[];
  turnUserId?: string | number | null;
  currentUserId?: string;
  reactionSourceTokenId?: number | null;
}) {
  const {
    sourceToken,
    combatIsActive,
    participantTokenIds = [],
    turnUserId,
    currentUserId,
    reactionSourceTokenId,
  } = args;

  if (!sourceToken || !combatIsActive) return false;
  if (!participantTokenIds.includes(sourceToken.id)) return false;
  if (!turnUserId) return false;

  const reactionModeAllowed = reactionSourceTokenId === sourceToken.id;
  return String(turnUserId) !== String(currentUserId) && !reactionModeAllowed;
}
