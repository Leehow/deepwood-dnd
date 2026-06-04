import type { SpellOption } from "../SelectionContextMenu";
import type { AreaSpellModeState } from "../hooks/useMapAreaSpellController";

import { parseDurationToRounds } from "~/utils/sidebarCasting";

type ShapeType = NonNullable<AreaSpellModeState["shapeType"]>;

interface GridPosition {
  x: number;
  y: number;
}

interface StructuredSpellSlotEntry {
  current: number;
  max?: number;
  [key: string]: unknown;
}

export type StructuredSpellSlotsState = Record<string, StructuredSpellSlotEntry>;

interface BuildAreaEffectDataArgs {
  shapeType: ShapeType;
  position: GridPosition;
  sizeFeet: number;
  currentMapUrl?: string | null;
  color?: string;
  followCaster?: boolean;
  direction?: number | null;
  originPos?: GridPosition | null;
}

interface BuildPersistentAreaEffectArgs extends BuildAreaEffectDataArgs {
  spell: Pick<SpellOption, "id" | "name" | "school"> & {
    duration?: string;
    damageType?: string;
    zoneEffects?: { color?: string } | null;
  };
  fromCaster: string;
}

interface BuildIllusionTokenPayloadArgs {
  campaignId: string | number;
  currentMapUrl?: string | null;
  position: GridPosition;
  sizeFeet: number;
  gridUnitLength: number;
  spell: Pick<SpellOption, "id" | "name">;
  sourceCharacterId?: number | null;
  illusionImageUrl?: string;
  illusionDesc?: string;
  illusionDisplayName?: string;
}

const INSTANTANEOUS_DURATION_LABELS = new Set(["立即", "瞬间", "Instantaneous"]);

const SCHOOL_ICONS: Record<string, string> = {
  abjuration: "🛡️",
  conjuration: "✨",
  divination: "👁️",
  enchantment: "💫",
  evocation: "🔥",
  illusion: "🌀",
  necromancy: "💀",
  transmutation: "🔄",
};

const SCHOOL_COLORS: Record<string, string> = {
  abjuration: "#60a5fa",
  conjuration: "#facc15",
  divination: "#22d3ee",
  enchantment: "#f472b6",
  evocation: "#f87171",
  illusion: "#a78bfa",
  necromancy: "#4ade80",
  transmutation: "#fb923c",
};

export function getAreaSpellSlotText(slotLevel?: number | null): string {
  return slotLevel && slotLevel > 0 ? `(${slotLevel}环)` : "(戏法)";
}

export function shouldConsumeAreaSpellSlot(args: {
  slotLevel?: number | null;
  characterId?: number | null;
  freecast?: boolean;
  ritualCast?: boolean;
}): boolean {
  return !!(
    args.slotLevel
    && args.slotLevel > 0
    && args.characterId
    && !args.freecast
    && !args.ritualCast
  );
}

export function isLastingAreaSpellDuration(duration?: string | null): boolean {
  const normalized = String(duration || "").trim();
  return !!normalized && !INSTANTANEOUS_DURATION_LABELS.has(normalized);
}

export function buildAreaEffectData({
  shapeType,
  position,
  sizeFeet,
  currentMapUrl,
  color,
  followCaster,
  direction,
  originPos,
}: BuildAreaEffectDataArgs) {
  return {
    shape: shapeType,
    center_x: position.x,
    center_y: position.y,
    radius: sizeFeet,
    map_url: currentMapUrl || "",
    ...(color ? { color } : {}),
    ...(followCaster ? { followCaster: true } : {}),
    ...(direction != null ? { direction } : {}),
    ...(originPos ? { origin_x: originPos.x, origin_y: originPos.y } : {}),
  };
}

export function buildPersistentAreaEffectPayload({
  spell,
  fromCaster,
  ...areaEffectArgs
}: BuildPersistentAreaEffectArgs) {
  const school = String(spell.school || "").toLowerCase();
  const duration = parseDurationToRounds(spell.duration || "") || 10;

  return {
    effect: {
      id: `spell_area_${spell.id}`,
      name: spell.name,
      spell_buff: true,
      spell_id: spell.id,
      is_concentration: false,
      icon: SCHOOL_ICONS[school] || "✨",
      color: SCHOOL_COLORS[school] || "#a78bfa",
      area_effect: buildAreaEffectData({
        ...areaEffectArgs,
        color: areaEffectArgs.color || spell.zoneEffects?.color || spell.damageType || "acid",
      }),
      duration,
      from_caster: fromCaster,
    },
  };
}

export function decrementLegacySpellSlots(currentSlots: unknown, slotLevel: number): number[] | null {
  if (!Array.isArray(currentSlots) || slotLevel <= 0 || currentSlots[slotLevel] <= 0) {
    return null;
  }

  const nextSlots = [...currentSlots];
  nextSlots[slotLevel] -= 1;
  return nextSlots;
}

export function decrementStructuredSpellSlotsState(
  currentSlotsState: unknown,
  slotLevel: number,
): StructuredSpellSlotsState | null {
  if (!currentSlotsState || typeof currentSlotsState !== "object" || slotLevel <= 0) {
    return null;
  }

  const slotKey = String(slotLevel);
  const record = currentSlotsState as StructuredSpellSlotsState;
  const slotData = record[slotKey];
  if (!slotData || typeof slotData.current !== "number" || slotData.current <= 0) {
    return null;
  }

  return {
    ...record,
    [slotKey]: {
      ...slotData,
      current: slotData.current - 1,
    },
  };
}

export function buildIllusionTokenPayload({
  campaignId,
  currentMapUrl,
  position,
  sizeFeet,
  gridUnitLength,
  spell,
  sourceCharacterId,
  illusionImageUrl,
  illusionDesc,
  illusionDisplayName,
}: BuildIllusionTokenPayloadArgs) {
  if (!illusionImageUrl) return null;

  const sizeGrids = Math.max(1, Math.round(sizeFeet / gridUnitLength));
  const tokenSize = `${sizeGrids}x${sizeGrids}`;

  return {
    campaign_id: typeof campaignId === "number" ? campaignId : parseInt(campaignId, 10),
    map_url: currentMapUrl,
    position_x: Math.round(position.x - sizeGrids / 2),
    position_y: Math.round(position.y - sizeGrids / 2),
    instance_name: illusionDisplayName || illusionDesc || spell.name,
    item_data: {
      type: "illusion",
      spell_id: spell.id,
      icon: illusionImageUrl,
      avatar_url: illusionImageUrl,
      avatar_url_large: illusionImageUrl,
      description: illusionDesc || "",
      caster_id: sourceCharacterId,
    },
    token_size: tokenSize,
  };
}
