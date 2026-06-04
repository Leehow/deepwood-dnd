/**
 * ZoneSpellSettlementModal - Modal for settling zone spell effects each round
 * DM can select which zone spells to settle and which targets to affect
 */
import { useState, useEffect, useMemo } from "react";
import { apiFetch } from "~/utils/api-client";
import type { Token, SpellAreaEffect } from "./types/TacticalMapTypes";
import {
  getDefaultZoneSettlementTiming,
  getSupportedZoneSettlementTimings,
  getZoneControlPresentation,
  type ZoneSettlementTiming,
} from "./utils/zoneSpellDefinitionUtils";

const ZONE_SETTLEMENT_LABELS: Record<ZoneSettlementTiming, string> = {
  enter: "进入时",
  start_turn: "回合开始",
  end_turn: "回合结束",
};
const ZONE_SETTLEMENT_BADGES: Record<ZoneSettlementTiming, string> = {
  enter: "⚡ 进入时结算",
  start_turn: "🔄 回合开始时结算",
  end_turn: "⏱️ 回合结束时结算",
};

interface ZoneSpell {
  tokenId: number;
  tokenName: string;
  spellId: string;
  spellName: string;
  areaEffect: SpellAreaEffect;
  spellSaveDC?: number;
  saveType?: string;
  saveTypeCn?: string;
  zoneTrigger?: string;
  condition?: string;
  conditionCn?: string;
  durationMode?: string;
}

function getSettlementBadgeLabel(timings: ZoneSettlementTiming[]): string {
  if (timings.length === 0) return "";
  if (timings.length === 1) return ZONE_SETTLEMENT_BADGES[timings[0]];
  return timings.map((timing) => ZONE_SETTLEMENT_LABELS[timing]).join(" / ") + " 结算";
}

interface TargetInZone {
  tokenId: number;
  tokenName: string;
  inZone: boolean;
  saveModifier?: number;
  isCaster: boolean;
}

interface ZoneSpellSettlementModalProps {
  open: boolean;
  onClose: () => void;
  campaignId: string;
  tokens: Token[];
  currentMapUrl: string | null | undefined;
  gridUnitLength: number;
  isDM: boolean;
  userId?: string;
  // If provided, only show this caster's spells (for player right-click)
  filterCasterTokenId?: number;
  onSettlementComplete?: (results: any) => void;
}

// Check if a token is inside a spell area
function isTokenInArea(
  token: Token,
  area: SpellAreaEffect,
  gridUnitLength: number
): boolean {
  // Get token center (accounting for token size)
  const tokenSize = token.token_size?.split("x").map(Number) || [1, 1];
  const tokenCenterX = token.position_x + tokenSize[0] / 2;
  const tokenCenterY = token.position_y + tokenSize[1] / 2;

  // Area center
  const areaCenterX = area.center_x;
  const areaCenterY = area.center_y;

  // Convert radius from feet to grid units
  const radiusGrids = area.radius / gridUnitLength;

  // Calculate distance
  const dx = tokenCenterX - areaCenterX;
  const dy = tokenCenterY - areaCenterY;
  const distance = Math.sqrt(dx * dx + dy * dy);

  switch (area.shape) {
    case "sphere":
    case "cylinder":
      return distance <= radiusGrids;
    case "cube":
      // Cube: check if within half-side length
      const halfSide = radiusGrids / 2;
      return Math.abs(dx) <= halfSide && Math.abs(dy) <= halfSide;
    case "cone":
    case "line":
      // Simplified: use origin point and direction
      // For now, treat as sphere for simplicity
      return distance <= radiusGrids;
    default:
      return distance <= radiusGrids;
  }
}

// Get spell data from spells.json
async function getSpellData(spellId: string): Promise<any> {
  try {
    const module = await import('~/data/rules/spells.json');
    const data = module.default as any;
    const spell = data.spells?.find((s: any) => s.id === spellId);
    return spell || null;
  } catch {
    return null;
  }
}

export function ZoneSpellSettlementModal({
  open,
  onClose,
  campaignId,
  tokens,
  currentMapUrl,
  gridUnitLength,
  isDM,
  userId,
  filterCasterTokenId,
  onSettlementComplete,
}: ZoneSpellSettlementModalProps) {
  const [selectedSpells, setSelectedSpells] = useState<Set<string>>(new Set());
  const [selectedTargets, setSelectedTargets] = useState<Record<string, Set<number>>>({});
  const [selectedTimings, setSelectedTimings] = useState<Record<string, ZoneSettlementTiming>>({});
  const [spellDetails, setSpellDetails] = useState<Record<string, any>>({});
  const [settling, setSettling] = useState(false);
  const [results, setResults] = useState<any[]>([]);

  const authedFetch = (input: RequestInfo | URL, init?: RequestInit) =>
    apiFetch(input, { ...init, userId });

  // Collect all active zone spells on the current map
  const zoneSpells = useMemo(() => {
    const spells: ZoneSpell[] = [];
    const seen = new Set<string>();
    for (const token of tokens) {
      const conc = token.concentration_spell;
      if (conc?.area_effect && conc.area_effect.map_url === currentMapUrl) {
        if (filterCasterTokenId !== undefined && token.id !== filterCasterTokenId) continue;
        const spellKey = `${token.id}-${conc.spell_id}`;
        if (!seen.has(spellKey)) {
          seen.add(spellKey);
          spells.push({
            tokenId: token.id,
            tokenName:
              token.instance_name || token.character_name || token.monster_name_cn || token.monster_name || "Unknown",
            spellId: conc.spell_id,
            spellName: conc.spell_name,
            areaEffect: conc.area_effect,
          });
        }
      }

      for (const effect of token.active_effects || []) {
        const zoneEffect = effect as Record<string, any>;
        if (!zoneEffect?.spell_buff || !zoneEffect.area_effect) continue;
        if (zoneEffect.area_effect.map_url !== currentMapUrl) continue;
        if (filterCasterTokenId !== undefined && token.id !== filterCasterTokenId) continue;
        const effectSpellId = zoneEffect.spell_id || zoneEffect.id;
        if (!effectSpellId) continue;
        const spellKey = `${token.id}-${effectSpellId}`;
        if (seen.has(spellKey)) continue;
        seen.add(spellKey);
        spells.push({
          tokenId: token.id,
          tokenName:
            token.instance_name || token.character_name || token.monster_name_cn || token.monster_name || "Unknown",
          spellId: effectSpellId,
          spellName: zoneEffect.spell_name || zoneEffect.name || effectSpellId,
          areaEffect: zoneEffect.area_effect,
        });
      }
    }
    return spells;
  }, [tokens, currentMapUrl, filterCasterTokenId]);

  // Load spell details for each zone spell
  useEffect(() => {
    if (!open) return;
    const loadSpellDetails = async () => {
      const details: Record<string, any> = {};
      for (const spell of zoneSpells) {
        const data = await getSpellData(spell.spellId);
        if (data) {
          details[spell.spellId] = data;
        }
      }
      setSpellDetails(details);
    };
    loadSpellDetails();
  }, [open, zoneSpells]);

  // Filter: only show spells that expose zone settlement timings (structured first, legacy fallback)
  const filteredZoneSpells = useMemo(() => {
    if (Object.keys(spellDetails).length === 0) return [];
    return zoneSpells.filter(spell => {
      const data = spellDetails[spell.spellId];
      return getSupportedZoneSettlementTimings(data).length > 0;
    });
  }, [zoneSpells, spellDetails]);

  const supportedTimingsBySpell = useMemo(() => {
    const timingMap: Record<string, ZoneSettlementTiming[]> = {};
    for (const spell of filteredZoneSpells) {
      const key = `${spell.tokenId}-${spell.spellId}`;
      timingMap[key] = getSupportedZoneSettlementTimings(spellDetails[spell.spellId]);
    }
    return timingMap;
  }, [filteredZoneSpells, spellDetails]);

  // Find targets in each zone
  const targetsInZones = useMemo(() => {
    const result: Record<string, TargetInZone[]> = {};
    for (const spell of filteredZoneSpells) {
      const key = `${spell.tokenId}-${spell.spellId}`;
      const targets: TargetInZone[] = [];
      for (const token of tokens) {
        // Skip non-creature tokens (items, shops, etc.)
        if (!token.character_id && !token.monster_instance_id) continue;
        // Check if in zone
        const inZone = isTokenInArea(token, spell.areaEffect, gridUnitLength);
        if (inZone) {
          targets.push({
            tokenId: token.id,
            tokenName: token.instance_name || token.character_name || token.monster_name_cn || token.monster_name || "Unknown",
            inZone: true,
            isCaster: token.id === spell.tokenId,
          });
        }
      }
      result[key] = targets;
    }
    return result;
  }, [filteredZoneSpells, tokens, gridUnitLength]);

  // Initialize selected spells and targets when opening
  useEffect(() => {
    if (open) {
      // Select all spells by default
      const allSpellKeys = new Set(filteredZoneSpells.map(s => `${s.tokenId}-${s.spellId}`));
      setSelectedSpells(allSpellKeys);
      // Select all non-caster targets by default
      const defaultTargets: Record<string, Set<number>> = {};
      for (const [key, targets] of Object.entries(targetsInZones)) {
        defaultTargets[key] = new Set(
          targets.filter(t => !t.isCaster).map(t => t.tokenId)
        );
      }
      setSelectedTargets(defaultTargets);
      const defaultTimings: Record<string, ZoneSettlementTiming> = {};
      for (const spell of filteredZoneSpells) {
        const key = `${spell.tokenId}-${spell.spellId}`;
        const defaultTiming = getDefaultZoneSettlementTiming(spellDetails[spell.spellId]);
        if (defaultTiming) {
          defaultTimings[key] = defaultTiming;
        }
      }
      setSelectedTimings(defaultTimings);
      setResults([]);
    }
  }, [open, filteredZoneSpells, spellDetails, targetsInZones]);

  const toggleSpell = (key: string) => {
    setSelectedSpells(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const toggleTarget = (spellKey: string, tokenId: number) => {
    setSelectedTargets(prev => {
      const next = { ...prev };
      if (!next[spellKey]) next[spellKey] = new Set();
      const targetSet = new Set(next[spellKey]);
      if (targetSet.has(tokenId)) {
        targetSet.delete(tokenId);
      } else {
        targetSet.add(tokenId);
      }
      next[spellKey] = targetSet;
      return next;
    });
  };

  const selectTiming = (spellKey: string, timing: ZoneSettlementTiming) => {
    setSelectedTimings((prev) => ({
      ...prev,
      [spellKey]: timing,
    }));
  };

  const handleSettle = async () => {
    setSettling(true);
    const allResults: any[] = [];

    try {
      for (const spellKey of selectedSpells) {
        const [tokenIdStr, spellId] = spellKey.split("-");
        const tokenId = parseInt(tokenIdStr);
        const spell = filteredZoneSpells.find(s => s.tokenId === tokenId && s.spellId === spellId);
        if (!spell) continue;
        const timing = selectedTimings[spellKey] || getDefaultZoneSettlementTiming(spellDetails[spell.spellId]);
        if (!timing) continue;

        const targetIds = Array.from(selectedTargets[spellKey] || []);
        if (targetIds.length === 0) continue;

        // Call backend API to settle this zone spell
        const response = await authedFetch(`/api/combat/zone-spell-settle`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign_id: parseInt(campaignId),
            caster_token_id: tokenId,
            spell_id: spellId,
            target_token_ids: targetIds,
            timing,
          }),
        });

        if (response.ok) {
          const result = await response.json();
          allResults.push({
            spellName: spell.spellName,
            casterName: spell.tokenName,
            settlementTiming: timing,
            ...result,
          });
        }
      }

      setResults(allResults);
      onSettlementComplete?.(allResults);
    } catch (error) {
      console.error("Zone spell settlement failed:", error);
    } finally {
      setSettling(false);
    }
  };

  if (!open) return null;

  // No zone spells active
  if (filteredZoneSpells.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
        <div className="bg-gray-800 rounded-lg p-6 max-w-md w-full mx-4">
          <h2 className="text-lg font-bold text-white mb-4">环境法术结算</h2>
          <p className="text-gray-400 mb-4">
            {filterCasterTokenId
              ? "你当前没有维持任何环境法术"
              : "当前地图上没有活跃的环境法术"}
          </p>
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
          >
            关闭
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[80dvh] overflow-y-auto">
        <h2 className="text-lg font-bold text-white mb-4">
          🌫️ 环境法术结算
        </h2>

        {/* Show results if settlement completed */}
        {results.length > 0 ? (
          <div className="space-y-4">
            <h3 className="text-md font-semibold text-green-400">结算完成</h3>
            {results.map((result, idx) => (
                <div key={idx} className="bg-gray-700 rounded p-3">
                  <div className="font-medium text-white mb-2">
                    {result.spellName} ({result.casterName})
                    {result.settlementTiming && (
                      <span className="ml-2 text-xs text-gray-400">
                        {ZONE_SETTLEMENT_LABELS[result.settlementTiming as ZoneSettlementTiming]}
                      </span>
                    )}
                  </div>
                {result.target_results?.map((tr: any, tidx: number) => (
                  <div key={tidx} className="text-sm text-gray-300 ml-2">
                    • {tr.target_name}: {tr.save_succeeded ? "✓" : "✗"}
                    {tr.save_total}(1d20{tr.save_modifier >= 0 ? "+" : ""}{tr.save_modifier})
                    → {tr.save_succeeded ? "无效" : tr.effect_applied || "受影响"}
                    {tr.damage_dealt > 0 && ` (${tr.damage_dealt}伤害)`}
                  </div>
                ))}
              </div>
            ))}
            <button
              onClick={onClose}
              className="w-full px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded"
            >
              关闭
            </button>
          </div>
        ) : (
          <>
            {/* Spell selection */}
            <div className="space-y-4 mb-6">
              {filteredZoneSpells.map((spell) => {
                const key = `${spell.tokenId}-${spell.spellId}`;
                const isSelected = selectedSpells.has(key);
                const targets = targetsInZones[key] || [];
                const spellData = spellDetails[spell.spellId];
                const controlPresentation = getZoneControlPresentation(spellData);
                const saveType = spellData?.saveType;
                const saveTypeCn = saveType === "con" ? "体质" : saveType === "dex" ? "敏捷" : saveType === "wis" ? "感知" : saveType === "str" ? "力量" : saveType === "int" ? "智力" : saveType === "cha" ? "魅力" : saveType;
                const damage = spellData?.damage;
                const damageTypeCn = spellData?.damageTypeCn;
                const saveEffect = spellData?.saveEffect; // "half" | "none"
                const supportedTimings = supportedTimingsBySpell[key] || [];
                const selectedTiming = selectedTimings[key] || supportedTimings[0];
                const settlementLabel = getSettlementBadgeLabel(supportedTimings);

                return (
                  <div
                    key={key}
                    className={`border rounded-lg p-4 transition-colors ${
                      isSelected
                        ? "border-blue-500 bg-gray-700"
                        : "border-gray-600 bg-gray-750"
                    }`}
                  >
                    {/* Spell header */}
                    <div className="flex items-center gap-3 mb-3">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSpell(key)}
                        className="w-5 h-5 rounded"
                      />
                      <div className="flex-1">
                        <div className="font-medium text-white flex items-center gap-2">
                          {spell.spellName}
                          {settlementLabel && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-gray-600 text-gray-300 font-normal">
                              {settlementLabel}
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-gray-400">
                          施法者: {spell.tokenName}
                        </div>
                        {/* 功能数值徽章 */}
                        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                          {/* 伤害 */}
                          {damage && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-900/60 text-red-300 border border-red-700/50 font-medium">
                              🎲 {damage}{damageTypeCn ? ` ${damageTypeCn}` : ''}
                            </span>
                          )}
                          {/* DC 豁免 */}
                          {spellData?.spellSaveDC && saveType && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 border border-blue-700/50 font-medium">
                              🛡️ DC {spellData.spellSaveDC} {saveTypeCn}
                            </span>
                          )}
                          {/* 豁免效果 */}
                          {saveEffect && (
                            <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium ${
                              saveEffect === 'half'
                                ? 'bg-emerald-900/60 text-emerald-300 border border-emerald-700/50'
                                : 'bg-orange-900/60 text-orange-300 border border-orange-700/50'
                            }`}>
                              {saveEffect === 'half' ? '✓ 成功减半' : '✓ 成功无效'}
                            </span>
                          )}
                          {/* 控制状态 */}
                          {controlPresentation.conditionCn && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-purple-900/60 text-purple-300 border border-purple-700/50 font-medium">
                              ⛓️ {controlPresentation.conditionCn}
                            </span>
                          )}
                        </div>
                        {supportedTimings.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="text-xs text-gray-400">结算时机:</span>
                            {supportedTimings.map((timing) => (
                              <button
                                key={timing}
                                type="button"
                                onClick={() => selectTiming(key, timing)}
                                className={`rounded-full border px-2 py-0.5 text-xs transition-colors ${
                                  selectedTiming === timing
                                    ? "border-blue-400 bg-blue-500/20 text-blue-200"
                                    : "border-gray-600 bg-gray-700 text-gray-300 hover:border-gray-500"
                                }`}
                              >
                                {ZONE_SETTLEMENT_LABELS[timing]}
                              </button>
                            ))}
                          </div>
                        )}
                        {controlPresentation.escapeHint && (
                          <div className="text-xs text-amber-400/80 mt-1">
                            💡 {controlPresentation.escapeHint}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Targets in zone */}
                    {isSelected && targets.length > 0 && (
                      <div className="ml-8 space-y-2">
                        <div className="text-sm text-gray-400 mb-2">
                          区域内的生物:
                        </div>
                        {targets.map((target) => (
                          <label
                            key={target.tokenId}
                            className={`flex items-center gap-2 text-sm ${
                              target.isCaster ? "text-gray-500" : "text-gray-200"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTargets[key]?.has(target.tokenId) || false}
                              onChange={() => toggleTarget(key, target.tokenId)}
                              disabled={target.isCaster}
                              className="w-4 h-4 rounded"
                            />
                            <span>
                              {target.tokenName}
                              {target.isCaster && " (施法者)"}
                            </span>
                          </label>
                        ))}
                        {targets.length === 0 && (
                          <div className="text-sm text-gray-500">
                            区域内没有其他生物
                          </div>
                        )}
                      </div>
                    )}

                    {isSelected && targets.filter(t => !t.isCaster).length === 0 && (
                      <div className="ml-8 text-sm text-gray-500">
                        区域内没有需要结算的目标
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded"
              >
                取消
              </button>
              <button
                onClick={handleSettle}
                disabled={settling || selectedSpells.size === 0}
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded"
              >
                {settling ? "结算中..." : "进行豁免检定"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
