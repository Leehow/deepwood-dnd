import { GRID_SIZE, type Token } from "../types/TacticalMapTypes";
import { dndSizeToTokenSize, parseTokenSize } from "./mapCalculations";
import { isExpiredByWorldTime } from "./runtimeSpellBadgeStatusUtils";

export interface RuntimeSpellLinkVisual {
  key: string;
  kind: "token" | "area";
  sourceTokenId: number;
  targetTokenId?: number | null;
  spellId?: string | null;
  spellName?: string | null;
  color: string;
  points: [number, number, number, number];
}

function getEffectiveTokenSize(token: Token) {
  const transformedSize = token.transformation_data?.size
    ? dndSizeToTokenSize(token.transformation_data.size)
    : undefined;
  return parseTokenSize(transformedSize || token.token_size);
}

function getTokenCenter(token: Token): { x: number; y: number; halfWidth: number; halfHeight: number } {
  const tokenSize = getEffectiveTokenSize(token);
  const width = tokenSize.width * GRID_SIZE;
  const height = tokenSize.height * GRID_SIZE;
  return {
    x: token.position_x * GRID_SIZE + width / 2,
    y: token.position_y * GRID_SIZE + height / 2,
    halfWidth: width / 2,
    halfHeight: height / 2,
  };
}

function buildTokenLink(
  sourceToken: Token,
  targetToken: Token,
  color: string,
  key: string,
  spellId?: string | null,
  spellName?: string | null,
): RuntimeSpellLinkVisual | null {
  const sourceCenter = getTokenCenter(sourceToken);
  const targetCenter = getTokenCenter(targetToken);
  const centerDistance = Math.hypot(targetCenter.x - sourceCenter.x, targetCenter.y - sourceCenter.y);
  if (centerDistance < GRID_SIZE * 0.4) return null;

  return {
    key,
    kind: "token",
    sourceTokenId: sourceToken.id,
    targetTokenId: targetToken.id,
    spellId,
    spellName,
    color,
    points: [sourceCenter.x, sourceCenter.y, targetCenter.x, targetCenter.y],
  };
}

function buildAreaLink(
  sourceToken: Token,
  areaCenter: { x: number; y: number },
  color: string,
  key: string,
  spellId?: string | null,
  spellName?: string | null,
): RuntimeSpellLinkVisual | null {
  const sourceCenter = getTokenCenter(sourceToken);
  const centerDistance = Math.hypot(areaCenter.x - sourceCenter.x, areaCenter.y - sourceCenter.y);
  if (centerDistance < GRID_SIZE * 0.4) return null;
  return {
    key,
    kind: "area",
    sourceTokenId: sourceToken.id,
    spellId,
    spellName,
    color,
    points: [sourceCenter.x, sourceCenter.y, areaCenter.x, areaCenter.y],
  };
}

export function buildRuntimeSpellLinks(
  visibleTokens: Token[],
  currentWorldTime?: {
    day?: number | null;
    hour?: number | null;
    minute?: number | null;
    second?: number | null;
  } | null,
): RuntimeSpellLinkVisual[] {
  if (visibleTokens.length === 0) return [];

  const visibleTokenMap = new Map(visibleTokens.map((token) => [token.id, token]));
  const links: RuntimeSpellLinkVisual[] = [];
  const seen = new Set<string>();

  for (const token of visibleTokens) {
    for (const overlay of token.spell_overlays || []) {
      if (isExpiredByWorldTime(overlay?.expires_at, currentWorldTime)) continue;
      if (overlay?.role !== "source" || !overlay.target_token_id) continue;
      const targetToken = visibleTokenMap.get(Number(overlay.target_token_id));
      if (!targetToken) continue;
      const key = `runtime:${overlay.runtime_instance_id}:token:${token.id}:${targetToken.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const link = buildTokenLink(
        token,
        targetToken,
        overlay.color || "#a855f7",
        key,
        overlay.spell_id,
        overlay.spell_name,
      );
      if (link) links.push(link);
    }

    const areaEffect = token.concentration_spell?.area_effect;
    if (!areaEffect || areaEffect.followCaster || isExpiredByWorldTime(token.concentration_spell?.expires_at, currentWorldTime)) continue;
    const areaCenter = {
      x: areaEffect.center_x * GRID_SIZE + GRID_SIZE / 2,
      y: areaEffect.center_y * GRID_SIZE + GRID_SIZE / 2,
    };
    const areaSpellId = token.concentration_spell?.spell_id || null;
    const areaSpellName = token.concentration_spell?.spell_name || null;
    const areaColor =
      (token.spell_overlays || []).find((entry) => entry?.role === "source")?.color
      || "#a855f7";
    const key = `concentration-area:${token.id}:${areaSpellId || "spell"}:${areaEffect.center_x}:${areaEffect.center_y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const link = buildAreaLink(token, areaCenter, areaColor, key, areaSpellId, areaSpellName);
    if (link) links.push(link);
  }

  return links;
}
