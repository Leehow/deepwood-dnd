import equipmentRulesData from "~/data/rules/equipment.json";
import { tProficiency } from "~/utils/i18n";

export interface ToolOption {
  id: string;
  label: string;
  nameEn?: string;
  category?: string;
  owned?: boolean;
  proficient?: boolean;
}

const TOOL_SYNONYMS: Record<string, string> = {
  navigator_tools: "navigators_tools",
  poisoner_kit: "poisoners_kit",
  poisoner_tools: "poisoners_kit",
};

const TOOL_CATEGORY_GRANTS: Record<string, string[]> = {
  artisansTools: ["artisan_tools", "artisans_tools"],
  musicalInstruments: ["musical_instrument"],
  gamingSets: ["gaming_set"],
};

export function normalizeToolId(toolId: string | null | undefined): string {
  if (!toolId) return "";
  const normalized = String(toolId).trim().toLowerCase().replace(/[\s-]+/g, "_");
  return TOOL_SYNONYMS[normalized] || normalized;
}

const RAW_RULE_TOOL_OPTIONS = (() => {
  const result: Array<{ id: string; label: string; nameEn?: string; category?: string }> = [];
  const rulesTools = (equipmentRulesData as any)?.tools || {};
  for (const [category, items] of Object.entries(rulesTools)) {
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!item?.id) continue;
      result.push({
        id: normalizeToolId(item.id),
        label: item.name || tProficiency(item.id),
        nameEn: item.nameEn,
        category,
      });
    }
  }
  return result;
})();

const RULE_TOOL_BY_ID = new Map(RAW_RULE_TOOL_OPTIONS.map(option => [option.id, option]));

function toolGrantsForTool(toolId: string): Set<string> {
  const normalized = normalizeToolId(toolId);
  if (!normalized) return new Set();
  const grants = new Set<string>([normalized]);
  const ruleTool = RULE_TOOL_BY_ID.get(normalized);
  if (ruleTool?.category && TOOL_CATEGORY_GRANTS[ruleTool.category]) {
    for (const grant of TOOL_CATEGORY_GRANTS[ruleTool.category]) {
      grants.add(grant);
    }
  }
  return grants;
}

export function hasToolProficiency(toolId: string, proficientToolIds: string[] | null | undefined): boolean {
  const normalizedToolId = normalizeToolId(toolId);
  if (!normalizedToolId) return false;
  const known = new Set((proficientToolIds || []).map(entry => normalizeToolId(entry)).filter(Boolean));
  if (known.has(normalizedToolId)) return true;
  for (const grant of toolGrantsForTool(normalizedToolId)) {
    if (known.has(grant)) return true;
  }
  return false;
}

function isToolLikeEquipment(item: any): boolean {
  const itemId = normalizeToolId(item?.id);
  if (!itemId) return false;
  if (String(item?.equipmentType || "").toLowerCase() === "tool") return true;
  if (String(item?.category || "").toLowerCase() === "tool") return true;
  if (RULE_TOOL_BY_ID.has(itemId)) return true;
  return /(_tools?|_supplies|_kit|_set|instrument|vehicles?_)/.test(itemId);
}

export function buildToolOptions(params: {
  equipment?: any[];
  proficientToolIds?: string[];
}): ToolOption[] {
  const options = new Map<string, ToolOption>();
  const ownedIds = new Set<string>();
  const proficientIds = (params.proficientToolIds || []).map(entry => normalizeToolId(entry)).filter(Boolean);

  for (const ruleTool of RAW_RULE_TOOL_OPTIONS) {
    options.set(ruleTool.id, { ...ruleTool });
  }

  for (const item of params.equipment || []) {
    if (!isToolLikeEquipment(item)) continue;
    const itemId = normalizeToolId(item.id);
    if (!itemId) continue;
    ownedIds.add(itemId);
    if (!options.has(itemId)) {
      options.set(itemId, {
        id: itemId,
        label: item.name || tProficiency(itemId),
      });
    }
  }

  for (const profId of proficientIds) {
    if (!options.has(profId)) {
      options.set(profId, {
        id: profId,
        label: tProficiency(profId),
      });
    }
  }

  return Array.from(options.values())
    .map(option => ({
      ...option,
      owned: ownedIds.has(option.id),
      proficient: hasToolProficiency(option.id, proficientIds),
    }))
    .sort((left, right) => {
      const leftScore = (left.proficient ? 2 : 0) + (left.owned ? 1 : 0);
      const rightScore = (right.proficient ? 2 : 0) + (right.owned ? 1 : 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return left.label.localeCompare(right.label, "zh-Hans-CN");
    });
}
