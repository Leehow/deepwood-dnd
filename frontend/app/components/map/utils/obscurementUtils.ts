/**
 * Obscurement utilities - detect and query obscured zones from concentration spells
 */
import type { Token, SpellAreaEffect } from "../types/TacticalMapTypes";
import { isExpiredByWorldTime } from "./runtimeSpellBadgeStatusUtils";

export interface ObscurementZone {
  shape: SpellAreaEffect["shape"];
  center_x: number;
  center_y: number;
  radius: number; // in feet
  obscurement: "heavy" | "light";
  spellId: string;
  casterId: number;
  color?: string;
}

/**
 * Scan all tokens for concentration spells with zoneEffects.obscurement,
 * returning active obscurement zones on the current map.
 */
export function getActiveObscurementZones(
  tokens: Token[],
  currentMapUrl: string | null | undefined,
  spellsData: any,
  currentWorldTime?: { day?: number | null; hour?: number | null; minute?: number | null; second?: number | null } | null,
): ObscurementZone[] {
  const allSpells: any[] = Array.isArray(spellsData)
    ? spellsData
    : spellsData?.spells || [];
  const zones: ObscurementZone[] = [];

  for (const t of tokens) {
    const conc = t.concentration_spell;
    if (
      !conc?.area_effect ||
      conc.area_effect.map_url !== currentMapUrl ||
      isExpiredByWorldTime(conc.expires_at, currentWorldTime)
    ) continue;

    // Look up spell in spells.json to check for obscurement
    const spellDef = allSpells.find((s: any) => s.id === conc.spell_id);
    const obscLevel = spellDef?.zoneEffects?.obscurement as "heavy" | "light" | undefined;
    if (!obscLevel) continue;

    const ae = conc.area_effect;
    zones.push({
      shape: ae.shape,
      center_x: ae.center_x,
      center_y: ae.center_y,
      radius: ae.radius,
      obscurement: obscLevel,
      spellId: conc.spell_id,
      casterId: t.id,
      color: ae.color,
    });
  }

  return zones;
}

/**
 * Check if a grid coordinate is inside an obscured zone.
 * gridX/gridY are grid-unit coordinates (same as token position_x/y).
 * Returns the strongest obscurement level at that point, or null.
 */
export function isPointInObscuredZone(
  gridX: number,
  gridY: number,
  zones: ObscurementZone[],
  gridUnitLength: number = 5
): "heavy" | "light" | null {
  let result: "heavy" | "light" | null = null;
  // Check center of the grid cell
  const px = gridX + 0.5;
  const py = gridY + 0.5;

  for (const z of zones) {
    const inZone = isInsideZone(px, py, z, gridUnitLength);
    if (inZone) {
      if (z.obscurement === "heavy") return "heavy"; // heavy is max
      result = "light";
    }
  }
  return result;
}

/**
 * Check if a token is fully inside an obscured zone.
 * D&D 5E: only fully enclosed tokens are hidden; partial overlap = still visible.
 * Checks ALL grid cells the token occupies — all must be inside for "heavy"/"light".
 */
export function isTokenInObscuredZone(
  token: Token,
  zones: ObscurementZone[],
  gridUnitLength: number = 5
): "heavy" | "light" | null {
  if (zones.length === 0) return null;
  const parts = (token.token_size || "1x1").split("x");
  const w = parseInt(parts[0]) || 1;
  const h = parseInt(parts[1]) || parseInt(parts[0]) || 1;

  // Check every grid cell the token occupies
  let worstLevel: "heavy" | "light" | null = "heavy";
  for (let dx = 0; dx < w; dx++) {
    for (let dy = 0; dy < h; dy++) {
      const cellLevel = isPointInObscuredZone(
        token.position_x + dx,
        token.position_y + dy,
        zones,
        gridUnitLength
      );
      if (!cellLevel) return null; // any cell outside → token is visible
      if (cellLevel === "light") worstLevel = "light";
    }
  }
  return worstLevel;
}

/** Internal: check if a point (in grid units) is inside a zone */
function isInsideZone(
  px: number,
  py: number,
  z: ObscurementZone,
  gridUnitLength: number
): boolean {
  const radiusGrids = z.radius / gridUnitLength;

  switch (z.shape) {
    case "sphere":
    case "cylinder": {
      const dx = px - z.center_x;
      const dy = py - z.center_y;
      return dx * dx + dy * dy <= radiusGrids * radiusGrids;
    }
    case "cube": {
      const half = radiusGrids / 2;
      return (
        Math.abs(px - z.center_x) <= half &&
        Math.abs(py - z.center_y) <= half
      );
    }
    default:
      // cone/line not supported for obscurement
      return false;
  }
}
