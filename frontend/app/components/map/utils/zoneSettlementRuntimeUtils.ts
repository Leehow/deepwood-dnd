import type { Token } from "../types/TacticalMapTypes";

export type ZoneInfo = { casterTokenId: number; spellId: string; area: any };
export type ZoneSettlementTiming = "enter" | "start_turn" | "end_turn";

export function isPointInArea(
  cx: number,
  cy: number,
  area: { shape: string; center_x: number; center_y: number; radius: number },
  gridUnitLength: number,
): boolean {
  const radiusGrids = area.radius / gridUnitLength;
  const dx = cx - area.center_x;
  const dy = cy - area.center_y;
  if (area.shape === "cube") {
    const half = radiusGrids / 2;
    return Math.abs(dx) <= half && Math.abs(dy) <= half;
  }
  return Math.sqrt(dx * dx + dy * dy) <= radiusGrids;
}

export function collectActiveZones(tokens: Token[], currentMapUrl?: string | null): ZoneInfo[] {
  const zones: ZoneInfo[] = [];
  for (const token of tokens) {
    const concentrationSpell = token.concentration_spell;
    if (
      concentrationSpell &&
      concentrationSpell.area_effect?.map_url === currentMapUrl &&
      concentrationSpell.spell_id
    ) {
      zones.push({
        casterTokenId: token.id,
        spellId: concentrationSpell.spell_id,
        area: concentrationSpell.area_effect,
      });
    }
    for (const effect of token.active_effects || []) {
      if (effect.spell_buff && effect.area_effect?.map_url === currentMapUrl) {
        zones.push({
          casterTokenId: token.id,
          spellId: effect.spell_id || effect.id,
          area: effect.area_effect,
        });
      }
    }
  }
  return zones;
}

export async function settleZoneForToken({
  authedFetch,
  campaignId,
  tokenId,
  zone,
  timing,
}: {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  tokenId: number;
  zone: ZoneInfo;
  timing: ZoneSettlementTiming;
}): Promise<Response> {
  return authedFetch("/api/combat/zone-spell-settle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign_id: parseInt(campaignId, 10),
      caster_token_id: zone.casterTokenId,
      spell_id: zone.spellId,
      target_token_ids: [tokenId],
      timing,
    }),
  });
}

export async function autoSettleZoneSpellsForMove({
  authedFetch,
  campaignId,
  currentMapUrl,
  gridUnitLength,
  tokens,
  tokenId,
  newX,
  newY,
}: {
  authedFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  campaignId: string;
  currentMapUrl?: string | null;
  gridUnitLength: number;
  tokens: Token[];
  tokenId: number;
  newX: number;
  newY: number;
}): Promise<void> {
  const movedToken = tokens.find((candidate) => candidate.id === tokenId);
  if (!movedToken || !currentMapUrl) return;

  const size = movedToken.token_size?.split("x").map(Number) || [1, 1];
  const newCx = newX + size[0] / 2;
  const newCy = newY + size[1] / 2;

  const zones = collectActiveZones(tokens, currentMapUrl);
  if (zones.length === 0) return;

  const affectedZones = zones.filter((zone) => isPointInArea(newCx, newCy, zone.area, gridUnitLength));
  if (affectedZones.length === 0) return;

  for (const zone of affectedZones) {
    const response = await settleZoneForToken({
      authedFetch,
      campaignId,
      tokenId,
      zone,
      timing: "enter",
    });
    if (!response.ok) {
      throw new Error(`Failed to settle zone spell for token ${tokenId}`);
    }
  }
}
