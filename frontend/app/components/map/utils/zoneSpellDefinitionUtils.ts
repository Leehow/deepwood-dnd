export type ZoneSettlementTiming = "enter" | "start_turn" | "end_turn";

const ZONE_SETTLEMENT_ORDER: ZoneSettlementTiming[] = ["enter", "start_turn", "end_turn"];
const ZONE_SETTLEMENT_TRIGGER_MAP: Record<string, ZoneSettlementTiming> = {
  on_enter_zone: "enter",
  start_of_target_turn: "start_turn",
  end_of_target_turn: "end_turn",
};

const ABILITY_CN: Record<string, string> = {
  str: "力量",
  strength: "力量",
  dex: "敏捷",
  dexterity: "敏捷",
  con: "体质",
  constitution: "体质",
  int: "智力",
  intelligence: "智力",
  wis: "感知",
  wisdom: "感知",
  cha: "魅力",
  charisma: "魅力",
};

function getStructuredZonePhases(spellData: any): any[] {
  return Array.isArray(spellData?.effects)
    ? spellData.effects.filter((phase: any) => {
        const trigger = String(phase?.trigger || "");
        const targetType = String(phase?.target?.type || "");
        return Boolean(ZONE_SETTLEMENT_TRIGGER_MAP[trigger]) && (targetType === "single" || targetType === "all_in_area");
      })
    : [];
}

function buildEscapeHint(escapeCfg: any): string | undefined {
  if (!escapeCfg || typeof escapeCfg !== "object") return undefined;
  const explicitHint = escapeCfg.escape_hint || escapeCfg.escapeHint;
  if (explicitHint) return String(explicitHint);

  const method = String(escapeCfg.method || escapeCfg.type || "").trim().toLowerCase();
  const ability = String(escapeCfg.ability || escapeCfg.save_type || "").trim().toLowerCase();
  const abilityCn = ABILITY_CN[ability] || ability || "属性";
  const timing = String(escapeCfg.trigger || escapeCfg.timing || "").trim().toLowerCase();
  const timingCn =
    timing === "start_of_turn" || timing === "start_turn" || timing === "start_of_target_turn"
      ? "每回合开始时"
      : "每回合结束时";

  if (method === "check") {
    return `可使用动作进行${abilityCn}检定对抗法术DC尝试挣脱`;
  }
  if (method === "save") {
    return `${timingCn}可进行${abilityCn}豁免，对抗法术DC以摆脱效果`;
  }
  return undefined;
}

export function getSupportedZoneSettlementTimings(spellData: any): ZoneSettlementTiming[] {
  const timings = new Set<ZoneSettlementTiming>();
  const structuredPhases = getStructuredZonePhases(spellData);

  for (const phase of structuredPhases) {
    const mapped = ZONE_SETTLEMENT_TRIGGER_MAP[String(phase?.trigger || "")];
    if (mapped) timings.add(mapped);
  }

  return ZONE_SETTLEMENT_ORDER.filter((timing) => timings.has(timing));
}

export function getDefaultZoneSettlementTiming(spellData: any): ZoneSettlementTiming | undefined {
  return getSupportedZoneSettlementTimings(spellData)[0];
}

export function hasZoneControlBehavior(spellData: any): boolean {
  return getSupportedZoneSettlementTimings(spellData).length > 0;
}

export function getZoneControlPresentation(spellData: any): {
  condition?: string;
  conditionCn?: string;
  escapeHint?: string;
} {
  for (const phase of getStructuredZonePhases(spellData)) {
    for (const effect of phase?.effects || []) {
      if (effect?.type !== "apply_condition") continue;
      const escapeCfg = effect?.escape || phase?.escape;
      return {
        condition: effect.condition,
        conditionCn: effect.condition_cn || effect.conditionCn || effect.condition,
        escapeHint:
          effect.escape_hint ||
          effect.escapeHint ||
          phase.escape_hint ||
          phase.escapeHint ||
          buildEscapeHint(escapeCfg),
      };
    }
  }

  return {};
}
