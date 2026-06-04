/**
 * Sidebar spellcasting utilities — concentration tracking + spell buff effects + targeting helpers
 */
import { apiFetch } from "~/utils/api-client";
import { fetchCampaignMapTokensCached } from "~/utils/mapTokensCache";
import { publishAppEvent } from "~/events/appEventBus";
import { useSpellSoundStore } from "~/stores/spellSoundStore";
import { getBuffEffects, getSpellSummonTokenConfig, isQuasiRealCreatureSpell } from "~/components/spell/spell-constants";
import { getAssetUrl } from "~/utils/asset-url";
import { deriveBuffConditions } from "~/utils/deriveBuffConditions";

// 本地副本，避免向上 import map 目录工具。与
// `components/map/utils/mapAreaSpellCastPrelude.isSummonSpell` 必须保持一致：
// 任何 phase 的 effects 数组里出现 `type: 'spawn_summon'` 即视为召唤系。
function isSummonSpellLike(spell: any): boolean {
  const phases = Array.isArray(spell?.effects) ? spell.effects : [];
  for (const phase of phases) {
    const leaves = Array.isArray(phase?.effects) ? phase.effects : [];
    for (const leaf of leaves) {
      if (leaf?.type === "spawn_summon") return true;
    }
  }
  return false;
}

/**
 * Convert a sidebar Spell object to the SpellOption format used by TacticalMap.
 * Handles both camelCase (frontend) and snake_case (backend) field names.
 */
export function spellToSpellOption(spell: any, spellSaveDC?: number): {
  id: string; name: string; level: number; school?: string;
  damage?: string; damageType?: string; damageTypeCn?: string;
  damageAtCharacterLevel?: Record<string, string>;
  damageAtSlotLevel?: Record<string, string>;
  healing?: string; healingAtSlotLevel?: Record<string, string>;
  attackType?: string; saveType?: string; saveTypeCn?: string; saveEffect?: string;
  range?: string; spellSaveDC?: number; concentration?: boolean;
  duration?: string;
  areaOfEffect?: { type?: string; size?: number };
  controlEffect?: any;
  buffEffects?: Record<string, any>;
  effects?: any[];
  illusion?: any;
  summonToken?: Record<string, any>;
} {
  const rawArea = spell.areaOfEffect || spell.area_of_effect;
  // 召唤系法术 (Conjure Animals 等) 没有 areaOfEffect，但走的是空地放置流程。
  // 给 SpellOption 合成一个 5 尺球形 area，避免地图控制器回落到 20 尺默认值。
  const areaOfEffect = rawArea
    ? rawArea
    : isSummonSpellLike(spell)
      ? { type: "sphere", size: 5 }
      : undefined;
  return {
    id: spell.id,
    name: spell.name,
    level: spell.level ?? 0,
    school: spell.school,
    damage: spell.damage,
    damageType: spell.damageType || spell.damage_type,
    damageTypeCn: spell.damageTypeCn || spell.damage_type_cn,
    damageAtCharacterLevel: spell.damageAtCharacterLevel || spell.damage_at_character_level,
    damageAtSlotLevel: spell.damageAtSlotLevel || spell.damage_at_slot_level,
    healing: spell.healing,
    healingAtSlotLevel: spell.healingAtSlotLevel || spell.healing_at_slot_level,
    attackType: spell.attackType || spell.attack_type,
    saveType: spell.saveType || spell.save_type,
    saveTypeCn: spell.saveTypeCn || spell.save_type_cn,
    saveEffect: spell.saveEffect || spell.save_effect,
    range: spell.range,
    spellSaveDC,
    concentration: spell.concentration,
    duration: spell.duration,
    areaOfEffect,
    controlEffect: spell.controlEffect || spell.control_effect,
    buffEffects: spell.buffEffects || spell.buff_effects,
    effects: spell.effects,
    illusion: spell.illusion,
    summonToken: spell.summonToken,
  };
}

/** Parse spell duration string to combat rounds (1 round = 6 seconds) */
export function parseDurationToRounds(duration: string | undefined): number | null {
  if (!duration) return null;
  // Match patterns like "专注, 至多 1 分钟" or "专注，至多 10 分钟"
  const match = duration.match(/(\d+)\s*(分钟|小时|轮)/);
  if (!match) return null;
  const value = parseInt(match[1]);
  const unit = match[2];
  if (unit === "轮") return value;
  if (unit === "分钟") return value * 10;
  if (unit === "小时") return value * 600;
  return null;
}

export function parseCastingTimeToSeconds(castingTime: string | undefined): number {
  if (!castingTime) return 1;
  const raw = castingTime.trim().toLowerCase();
  const match = raw.match(/(\d+)\s*(bonus action|bonus_action|reaction|action|round|rounds|minute|minutes|hour|hours|轮|分钟|小时)/);
  if (match) {
    const value = parseInt(match[1], 10);
    const unit = match[2];
    if (unit === 'minute' || unit === 'minutes' || unit === '分钟') return value * 60;
    if (unit === 'hour' || unit === 'hours' || unit === '小时') return value * 3600;
    if (unit === 'round' || unit === 'rounds' || unit === '轮') return value * 6;
    return 1;
  }
  if (castingTime.includes('分钟')) return 60;
  if (castingTime.includes('小时')) return 3600;
  if (castingTime.includes('轮')) return 6;
  return 1;
}

export function requiresCastingInProgress(spell: any, ritualCast?: boolean): boolean {
  return parseCastingTimeToSeconds(spell.castingTime || spell.casting_time) + (ritualCast ? 600 : 0) >= 60;
}

type OnHitWeaponBuffSpec = {
  damageFormula: string;
  damageType: string;
  consumeOnHit: boolean;
  icon: string;
  color: string;
};

const ON_HIT_DAMAGE_VISUALS: Record<string, { icon: string; color: string }> = {
  radiant: { icon: "✨", color: "#eab308" },
  necrotic: { icon: "💀", color: "#7c3aed" },
  fire: { icon: "🔥", color: "#f97316" },
  thunder: { icon: "⚡", color: "#6366f1" },
  psychic: { icon: "😡", color: "#dc2626" },
  cold: { icon: "❄️", color: "#38bdf8" },
  lightning: { icon: "⚡", color: "#facc15" },
  acid: { icon: "🧪", color: "#22c55e" },
  force: { icon: "💫", color: "#a78bfa" },
  poison: { icon: "🤢", color: "#16a34a" },
};

function getSpellPhases(spell: any): any[] {
  return Array.isArray(spell?.effects) ? spell.effects : [];
}

function getOnHitWeaponBuffPhase(spell: any): any | null {
  return getSpellPhases(spell).find((phase: any) => {
    if (phase?.trigger !== "on_hit") return false;
    if ((phase?.target?.type || "") !== "single") return false;
    return Array.isArray(phase?.effects) && phase.effects.some((effect: any) => effect?.type === "deal_damage");
  }) ?? null;
}

export function hasOnHitWeaponBuff(spell: any): boolean {
  return !!getOnHitWeaponBuffPhase(spell);
}

function buildScaledFormula(baseFormula: string, scaling: any, castLevel: number, baseLevel: number): string {
  if (!scaling) return baseFormula;
  const levelsAbove = castLevel - baseLevel;
  if (levelsAbove <= 0) return baseFormula;

  if (scaling.extra_dice && scaling.per_slot_above) {
    const match = String(scaling.extra_dice).match(/^(\d+)d(\d+)$/);
    if (match) {
      const count = parseInt(match[1], 10) * levelsAbove;
      return `${baseFormula}+${count}d${match[2]}`;
    }
    return `${baseFormula}+${String(scaling.extra_dice)}`;
  }

  if (typeof scaling.extra_value === "number") {
    return `${baseFormula}+${scaling.extra_value * levelsAbove}`;
  }

  return baseFormula;
}

function getOnHitWeaponBuffSpec(spell: any, castLevel: number): OnHitWeaponBuffSpec | null {
  const phase = getOnHitWeaponBuffPhase(spell);
  if (!phase) return null;

  const damageEffect = phase.effects.find((effect: any) => effect?.type === "deal_damage");
  if (!damageEffect?.formula || !damageEffect?.damage_type) return null;

  const damageType = String(damageEffect.damage_type);
  const visual = ON_HIT_DAMAGE_VISUALS[damageType] || { icon: "⚔️", color: "#9ca3af" };
  const damageFormula = buildScaledFormula(
    String(damageEffect.formula),
    phase.scaling,
    castLevel,
    Number(spell?.level ?? 0),
  );

  return {
    damageFormula,
    damageType,
    consumeOnHit: !phase.duration,
    icon: visual.icon,
    color: visual.color,
  };
}

/** Find a character's token on the current map, returns { id, data } */
export async function findCharacterToken(
  characterId: number, campaignId: string, currentMapUrl: string | null, userId?: string
): Promise<{ id: number; data: any } | null> {
  if (!currentMapUrl || !campaignId) return null;
  try {
    const data = await fetchCampaignMapTokensCached(parseInt(campaignId), currentMapUrl, { userId });
    const token = (data.tokens || []).find((t: any) => t.character_id === characterId);
    return token ? { id: token.id, data: token } : null;
  } catch {
    return null;
  }
}

/** Set concentration spell on a token via existing API */
export async function setConcentrationOnToken(
  tokenId: number,
  spell: { id: string; name: string; duration?: string; illumination?: any },
  level: number,
  userId?: string,
  targetName?: string,
  affectedTokenIds?: number[],
  areaEffect?: { shape: string; center_x: number; center_y: number; radius: number; map_url: string; color?: string; direction?: number; origin_x?: number; origin_y?: number },
  extraData?: Record<string, any>,
): Promise<boolean> {
  const durationRounds = parseDurationToRounds(spell.duration);
  try {
    const resp = await apiFetch(`/api/tokens/${tokenId}/concentration`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        concentration_spell: {
          spell_id: spell.id,
          spell_name: spell.name,
          slot_level: level,
          duration_rounds: durationRounds ?? 10,
          current_round: 0,
          affected_token_ids: affectedTokenIds || [],
          ...(targetName ? { target_name: targetName } : {}),
          ...(spell.illumination ? { illumination: spell.illumination } : {}),
          ...(areaEffect ? { area_effect: areaEffect } : {}),
          ...(extraData || {}),
        },
      }),
      userId,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** Add a spell buff effect to a token's active_effects via existing API */
export async function addSpellBuffToToken(
  tokenId: number,
  spell: { id: string; name: string },
  level: number,
  currentEffects: any[],
  userId?: string
): Promise<boolean> {
  const effect = getOnHitWeaponBuffSpec(spell, level);
  if (!effect) return false;

  // Remove any existing spell buff from the same spell
  const filtered = currentEffects.filter((e: any) => !(e.spell_buff && e.spell_id === spell.id));
  const newEffect = {
    id: `${spell.id}_buff`,
    name: spell.name,
    icon: effect.icon,
    color: effect.color,
    spell_buff: true,
    spell_id: spell.id,
    trigger: "on_next_melee_hit",
    consume_on_hit: effect.consumeOnHit,
    extra_damage_dice: effect.damageFormula,
    damage_type: effect.damageType,
  };

  try {
    const resp = await apiFetch(`/api/tokens/${tokenId}/active-effects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active_effects: [...filtered, newEffect] }),
      userId,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/** School → icon mapping for generic spell buffs on targets */
const SCHOOL_ICONS: Record<string, string> = {
  abjuration: '🛡️', conjuration: '✨', divination: '👁️', enchantment: '💫',
  evocation: '🔥', illusion: '🌀', necromancy: '💀', transmutation: '🔄',
};
const SCHOOL_COLORS: Record<string, string> = {
  abjuration: '#60a5fa', conjuration: '#facc15', divination: '#22d3ee', enchantment: '#f472b6',
  evocation: '#f87171', illusion: '#a78bfa', necromancy: '#4ade80', transmutation: '#fb923c',
};

/** Add a spell buff effect to a TARGET token's active_effects (atomic, no race condition) */
export async function addTargetSpellBuff(
  targetTokenId: number,
  spell: { id: string; name: string; school?: string; duration?: string; iconPath?: string; concentration?: boolean; buffEffects?: Record<string, any>; illumination?: any; effects?: any[] },
  casterName: string,
  userId?: string,
): Promise<boolean> {
  const school = spell.school?.toLowerCase() || '';
  const durationRounds = parseDurationToRounds(spell.duration);
  // Skip indicator for instantaneous spells (no lasting effect)
  const dur = (spell.duration || '').trim();
  if (!dur || dur === '立即' || dur === '瞬间' || dur.toLowerCase() === 'instantaneous') {
    return false;
  }

  const newEffect: Record<string, any> = {
    id: `spell_buff_${spell.id}`,
    name: spell.name,
    icon: SCHOOL_ICONS[school] || '✨',
    color: SCHOOL_COLORS[school] || '#a78bfa',
    spell_buff: true,
    spell_id: spell.id,
    from_caster: casterName,
    icon_path: spell.iconPath || `/assets/spell-icons/${spell.id}.png`,
    duration_rounds: durationRounds,
  };
  if (spell.buffEffects) newEffect.buff_effects = spell.buffEffects;
  if (spell.illumination) newEffect.illumination = spell.illumination;
  // Condition badges come ONLY from conditions the spell actually applies
  // (apply_condition effects), never the loose top-level `conditions` tag (BUG B).
  const derivedConditions = deriveBuffConditions(spell);
  if (derivedConditions.length) newEffect.conditions = derivedConditions;
  try {
    const resp = await apiFetch(`/api/tokens/${targetTokenId}/add-effect`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effect: newEffect }),
      userId,
    });
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Roll dice from a formula string (e.g., "2d6", "1d4+4")
 * Returns the total result.
 */
function rollDice(formula: string): number {
  // Match "XdY" optionally followed by "+Z"
  const m = formula.match(/^(\d+)d(\d+)(?:\s*\+\s*(\d+))?$/);
  if (!m) {
    const num = parseInt(formula);
    return isNaN(num) ? 0 : num;
  }
  const count = parseInt(m[1]);
  const sides = parseInt(m[2]);
  const bonus = m[3] ? parseInt(m[3]) : 0;
  let total = bonus;
  for (let i = 0; i < count; i++) {
    total += Math.floor(Math.random() * sides) + 1;
  }
  return total;
}

type TempHpSpec = {
  formula: string;
  extraValuePerSlot?: number;
};

function getTempHpSpec(spell: any): TempHpSpec | null {
  for (const phase of getSpellPhases(spell)) {
    const grant = Array.isArray(phase?.effects)
      ? phase.effects.find((effect: any) => effect?.type === "grant_temp_hp")
      : null;
    if (!grant?.formula) continue;
    return {
      formula: String(grant.formula),
      extraValuePerSlot:
        typeof phase?.scaling?.extra_value === "number"
          ? phase.scaling.extra_value
          : typeof phase?.scaling?.extra_temp_hp === "number"
            ? phase.scaling.extra_temp_hp
            : undefined,
    };
  }
  return null;
}

/**
 * Grant temporary HP from a spell's tempHp formula.
 * Calls PUT /api/tokens/{id}/temp-hp (backend takes higher value).
 */
export async function grantTempHpFromSpell(
  tokenId: number,
  spell: any,
  slotLevel: number,
  userId?: string,
): Promise<number | null> {
  const spec = getTempHpSpec(spell);
  if (!spec) return null;
  const tempHpFormula = spec.formula;

  // Parse formula: "5" → flat, "1d4+4" → roll, "2d6" → roll
  // Skip variable formulas like "CHA_mod/round", "level + ATTR_mod"
  if (tempHpFormula.includes('mod') || tempHpFormula.includes('ATTR') || tempHpFormula.includes('level')) {
    return null;
  }

  // Strip parenthetical notes like "(Bear's Endurance)"
  const cleanFormula = tempHpFormula.replace(/\s*\(.*\)/, '').trim();

  let tempHp = rollDice(cleanFormula);

  // Upcast bonus
  const upcastBonus = spec.extraValuePerSlot;
  const spellBaseLevel = Number(spell?.level ?? 0);
  if (upcastBonus && slotLevel > spellBaseLevel) {
    tempHp += upcastBonus * (slotLevel - spellBaseLevel);
  }

  if (tempHp <= 0) return null;

  try {
    await apiFetch(`/api/tokens/${tokenId}/temp-hp`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temp_hp: tempHp }),
      userId,
    });
    return tempHp;
  } catch {
    return null;
  }
}

/**
 * Build structured spell cast data for the card renderer.
 */
export function buildSpellCastData(
  spellName: string,
  slotLevel: number,
  apiResult: any,
): {
  spellName: string;
  slotLevel: number;
  spellId?: string;
  casterTokenId?: number;
  results: any[];
  totalDamage: number;
  totalHealing: number;
  concentrationSet: boolean;
  durationHint?: string;
} {
  return {
    spellName,
    slotLevel,
    spellId: apiResult.spell_id || undefined,
    casterTokenId:
      typeof apiResult.caster_token_id === 'number'
        ? apiResult.caster_token_id
        : undefined,
    results: apiResult.results || [],
    totalDamage: apiResult.total_damage || 0,
    totalHealing: apiResult.total_healing || 0,
    concentrationSet: apiResult.concentration_set || false,
    durationHint: apiResult.duration_hint || undefined,
  }
}

/**
 * Format a rich chat message from a spell cast API result.
 */
export function formatSpellChatMessage(
  spellName: string,
  slotLevel: number,
  apiResult: any,
): string {
  const header = slotLevel === 0
    ? `🔮 施放戏法【${spellName}】`
    : `🔮 使用${slotLevel}环法术位施放【${spellName}】`;

  const parts: string[] = [];
  // Track which targets already had attack/save info shown (deduplicate)
  const attackShownForTarget = new Set<string>();
  const saveShownForTarget = new Set<string>();
  for (const er of (apiResult.results || [])) {
    const target = er.target_name || '目标';
    const targetKey = `${er.target_token_id ?? target}`;
    const segs: string[] = [];
    // Attack (不显示AC，只有DM能看到AC) — only show once per target
    if (er.attack_rolled && !attackShownForTarget.has(targetKey)) {
      attackShownForTarget.add(targetKey);
      const roll = er.attack_roll || '?';
      const total = er.attack_total || '?';
      if (er.critical_hit) {
        segs.push(`🎯 暴击! (${roll}→${total})`);
      } else if (er.attack_hit) {
        segs.push(`🎯 命中 (${roll}→${total})`);
      } else {
        segs.push(`❌ 未命中 (${roll}→${total})`);
      }
    }
    // Save — only show once per target
    if (er.save_rolled && !saveShownForTarget.has(targetKey)) {
      saveShownForTarget.add(targetKey);
      const dc = er.save_dc || '?';
      const total = er.save_total || '?';
      segs.push(er.save_succeeded
        ? `🛡️ 豁免成功 (${total} vs DC${dc})`
        : `💥 豁免失败 (${total} vs DC${dc})`
      );
    }
    // Damage
    if (er.damage_dealt > 0) {
      const formula = er.formula_breakdown || '';
      segs.push(`⚔️ ${target} 受到 ${er.damage_dealt} 点伤害${formula ? ` [${formula}]` : ''}`);
    }
    // Healing
    if (er.healing_done > 0) {
      segs.push(`💚 ${target} 恢复 ${er.healing_done} 点生命`);
    }
    // Temp HP
    if (er.temp_hp_granted > 0) {
      segs.push(`🛡️ ${target} 获得 ${er.temp_hp_granted} 临时HP`);
    }
    // Condition
    if (er.condition_applied) {
      segs.push(`📌 ${target} → ${er.condition_applied}`);
    }
    if (er.condition_immune) {
      segs.push(`🚫 ${target} 免疫该状态`);
    }
    // Buff descriptions
    if (er.type === 'narrative' && er.description) {
      // Truncate long narrative descriptions for chat
      const desc = er.description.length > 60
        ? er.description.slice(0, 60) + '…'
        : er.description;
      segs.push(desc);
    } else if (['modify_stat', 'modify_roll', 'grant_resistance', 'grant_advantage'].includes(er.type) && er.description) {
      segs.push(`✨ ${er.description}`);
    } else if (er.type === 'generate_item' && er.description) {
      segs.push(`📦 ${er.description}`);
    }
    if (segs.length > 0) parts.push(segs.join(' '));
  }

  // Duration hint
  if (apiResult.duration_hint) {
    parts.push(`⏳ ${apiResult.duration_hint}`);
  }
  if (apiResult.concentration_set) {
    parts.push('🔵 专注');
  }

  return parts.length > 0 ? `${header}  \n${parts.join('  \n')}` : header;
}

/**
 * Call the unified /api/spells/cast endpoint.
 * Returns the parsed response, or null on failure.
 */
export async function castSpellViaAPI(
  spellId: string,
  slotLevel: number,
  casterTokenId: number,
  targetTokenIds: number[],
  campaignId: string,
  userId?: string,
  freecast?: boolean,
  ritualCast?: boolean,
  selectedOption?: string,
  materialId?: string,
  illusionData?: { imageUrl?: string; description?: string; displayName?: string },
  targetAutoFailSave?: boolean,
  teleportDestination?: { x: number; y: number },
): Promise<any | null> {
  try {
    const resp = await apiFetch('/api/spells/cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spell_id: spellId,
        slot_level: slotLevel,
        caster_token_id: casterTokenId,
        target_token_ids: targetTokenIds,
        campaign_id: parseInt(campaignId),
        freecast: !!freecast,
        ritual_cast: !!ritualCast,
        ...(selectedOption ? { selected_option: selectedOption } : {}),
        ...(materialId ? { material_id: materialId } : {}),
        ...(illusionData && (illusionData.imageUrl || illusionData.description || illusionData.displayName)
          ? {
              illusion_data: {
                ...(illusionData.imageUrl ? { image_url: illusionData.imageUrl } : {}),
                ...(illusionData.description ? { description: illusionData.description } : {}),
                ...(illusionData.displayName ? { display_name: illusionData.displayName } : {}),
              },
            }
          : {}),
        ...(targetAutoFailSave ? { target_auto_fail_save: true } : {}),
        ...(teleportDestination
          ? { teleport_destination: { x: teleportDestination.x, y: teleportDestination.y } }
          : {}),
      }),
      userId,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

export async function syncCharacterSpellSlotsFromBackend(
  characterId: number,
  options?: { delayMs?: number },
): Promise<void> {
  if (!characterId) return;
  try {
    if ((options?.delayMs ?? 0) > 0) {
      await new Promise((resolve) => setTimeout(resolve, options?.delayMs ?? 0));
    }
    const response = await apiFetch(`/api/characters/${characterId}`);
    if (!response.ok) return;
    const data = await response.json();
    publishAppEvent("spellSlotsUpdate", {
      character_id: characterId,
      spell_slots_state: data?.spell_slots_state,
    });
  } catch {
    // Ignore sync failures; websocket/backfill can still reconcile later.
  }
}

export async function startSpellCastViaAPI(
  spellId: string,
  slotLevel: number,
  casterTokenId: number,
  campaignId: string,
  userId?: string,
  options?: {
    freecast?: boolean;
    ritualCast?: boolean;
    selectedOption?: string;
    materialId?: string;
    targetTokenIds?: number[];
    confirmBreakConcentration?: boolean;
    areaEffect?: Record<string, any> | null;
  }
): Promise<any | null> {
  try {
    const resp = await apiFetch('/api/spells/start-cast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spell_id: spellId,
        slot_level: slotLevel,
        caster_token_id: casterTokenId,
        campaign_id: parseInt(campaignId, 10),
        target_token_ids: options?.targetTokenIds || [],
        freecast: !!options?.freecast,
        ritual_cast: !!options?.ritualCast,
        confirm_break_concentration: !!options?.confirmBreakConcentration,
        ...(options?.selectedOption ? { selected_option: options.selectedOption } : {}),
        ...(options?.materialId ? { material_id: options.materialId } : {}),
        ...(options?.areaEffect ? { area_effect: options.areaEffect } : {}),
      }),
      userId,
    });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

/**
 * Universal spell cast action — call from ANY spell button (sidebar, spell book, etc.)
 * Handles self-buff immediately; dispatches map targeting for area/single-target.
 */
export async function castSpellAction(
  spell: any,
  level: number,
  characterId: number,
  opts?: {
    campaignId?: string;
    currentMapUrl?: string | null;
    userId?: string;
    spellSaveDC?: number;
    onClose?: () => void;
    /** Skip spell slot consumption (e.g. at-will invocation spells) */
    freecast?: boolean;
    /** Illusion image URL for creating illusion token on map */
    illusionImageUrl?: string;
    /** Illusion description text */
    illusionDesc?: string;
    /** LLM-generated display name for illusion token */
    illusionDisplayName?: string;
    /** Override area size (for sizeIsMax spells where user chose a smaller area) */
    areaSize?: number;
    /** Selected cast option key (e.g. "enlarge" or "reduce") */
    selectedOption?: string;
    /** Material ID to consume on cast */
    materialId?: string;
    /** Cast as ritual when supported */
    ritualCast?: boolean;
    /** Force confirm that current concentration can be replaced by long cast */
    confirmBreakConcentration?: boolean;
    /** 入口中间件提供的目标模式，避免重复推导 */
    targetingMode?: import('~/types/spellCastUI').TargetingMode;
  }
) {
  const ritualCast = !!opts?.ritualCast;
  const area = spell.areaOfEffect || spell.area_of_effect;
  const range: string = spell.range || '';
  const isLongCast = requiresCastingInProgress(spell, ritualCast);

  // 优先使用入口中间件提供的 targetingMode，否则回退到本地推导
  const tm = opts?.targetingMode;
  const isSelfBuff = tm ? (tm === 'self' || tm === 'self_area') : (range === '自身' && !area);

  // Long-cast spells whose mechanics deposit at the caster (self buffs) or whose
  // mechanics are self-conjured familiars (Find Familiar / Phantom Steed —
  // structured as `spawn_summon` with no explicit area) historically start the
  // long cast timer immediately without an extra placement step. Anything else
  // (touch / ranged single-target like Identify, area spells like Alarm, etc.)
  // must follow the normal target/area picker first so the placement can be
  // preserved on `casting_in_progress` and used at release time.
  const longCastStartsImmediately =
    isSelfBuff
    || (!area && isSummonSpellLike(spell))
    || (!area && isQuasiRealCreatureSpell(spell));

  if (isLongCast && longCastStartsImmediately) {
    const result = await findCharacterToken(
      characterId, opts?.campaignId || '', opts?.currentMapUrl ?? null, opts?.userId
    );
    if (!result || !opts?.campaignId) return;
    const startResult = await startSpellCastViaAPI(
      spell.id,
      level,
      result.id,
      opts.campaignId,
      opts?.userId,
      {
        freecast: opts?.freecast,
        ritualCast,
        selectedOption: opts?.selectedOption,
        materialId: opts?.materialId,
        confirmBreakConcentration: opts?.confirmBreakConcentration,
      }
    );
    if (!startResult) return;
    if (startResult.requires_confirmation && !opts?.confirmBreakConcentration) {
      const confirmed = typeof window === 'undefined'
        ? false
        : window.confirm(`开始施放【${spell.name || spell.id}】会打断当前专注，是否继续？`);
      if (!confirmed) return;
      return castSpellAction(spell, level, characterId, {
        ...opts,
        ritualCast,
        confirmBreakConcentration: true,
      });
    }
    if (!startResult.success) return startResult;
    publishAppEvent("spellCastStarted", {
      characterId,
      tokenId: result.id,
      spell,
      level,
      ritualCast,
      response: startResult,
    });
    const spellName = spell.name || spell.id;
    const prefix = ritualCast ? '开始进行仪式施法' : '开始长时间施法';
    publishAppEvent("spellCastChat", {
      message: `⏳ ${prefix}【${spellName}】`,
      characterId,
    });
    useSpellSoundStore.getState().playSpellSound(spell.id, 'cast', spell.damageType || spell.damage_type);
    opts?.onClose?.();
    return startResult;
  }

  if (isSelfBuff) {
    const result = await findCharacterToken(
      characterId, opts?.campaignId || '', opts?.currentMapUrl ?? null, opts?.userId
    );
    if (result) {
      const { id: tokenId, data: tokenData } = result;

      // Try unified API for spells with structured effects
      const hasEffects = spell.effects && Array.isArray(spell.effects) && spell.effects.length > 0;
      if (hasEffects && opts?.campaignId) {
        const apiResult = await castSpellViaAPI(
          spell.id, level, tokenId, [tokenId], opts.campaignId, opts?.userId,
          opts?.freecast, ritualCast, opts?.selectedOption, opts?.materialId,
          {
            imageUrl: opts?.illusionImageUrl || undefined,
            description: opts?.illusionDesc || undefined,
            displayName: opts?.illusionDisplayName || undefined,
          },
        );
        if (apiResult?.success) {
          // Structured spell casts already deduct slots on the backend and often
          // broadcast authoritative slot state before our local optimistic event lands.
          // Pull the canonical state immediately instead of subtracting again locally.
          void syncCharacterSpellSlotsFromBackend(characterId, { delayMs: 50 });
          // API handled concentration + effects + broadcast + spell slot deduction
          const spellName = spell.name || spell.id;
          const chatMsg = formatSpellChatMessage(spellName, level, apiResult);
          const spellCastData = buildSpellCastData(spellName, level, apiResult);
          publishAppEvent("spellCastChat", { message: chatMsg, characterId, spellCastData });
          useSpellSoundStore.getState().playSpellSound(spell.id, 'cast', spell.damageType || spell.damage_type);
          opts?.onClose?.();
          return;
        }
        // Appearance disguises now belong to the unified spell cast chain; do not
        // fall back to legacy token-side disguise mutation here.
        if (opts?.illusionImageUrl) return apiResult;
      }

      // Legacy path: manual concentration + buff + tempHp
      if (spell.concentration) {
        await setConcentrationOnToken(tokenId, spell, level, opts?.userId);
      }
      if (hasOnHitWeaponBuff(spell)) {
        await addSpellBuffToToken(tokenId, spell, level, tokenData?.active_effects || [], opts?.userId);
      } else if (spell.concentration || level > 0) {
        await addTargetSpellBuff(tokenId, spell, '自身', opts?.userId);
      }
      const buffEffects = getBuffEffects(spell.id, spell.buffEffects || spell.buff_effects);
      if (buffEffects?.tempHp) {
        await grantTempHpFromSpell(tokenId, spell, level, opts?.userId);
      }
    }
    // Legacy path: consume spell slot after operations complete
    if (level > 0 && !opts?.freecast && !ritualCast) {
      publishAppEvent("consumeSpellSlot", { level, characterId });
    }
    // Notify chat panel about self-buff spell cast
    const spellName = spell.name || spell.id;
    const chatMsg = level === 0
      ? `🔮 施放戏法【${spellName}】`
      : `🔮 使用${level}环法术位施放【${spellName}】`;
    publishAppEvent("spellCastChat", { message: chatMsg, characterId });
    // Play cast sound for self-buff spells
    useSpellSoundStore.getState().playSpellSound(spell.id, 'cast', spell.damageType || spell.damage_type);

    opts?.onClose?.();
    return;
  }

  // Phantom Steed: auto-summon preset horse token next to caster
  const summonToken = getSpellSummonTokenConfig(spell);
  if (isQuasiRealCreatureSpell(spell) && summonToken) {
    const result = await findCharacterToken(
      characterId, opts?.campaignId || '', opts?.currentMapUrl ?? null, opts?.userId
    );
    if (result) {
      const casterToken = result.data;
      // Place horse token adjacent to caster (1 grid right)
      const parts = (casterToken.token_size || '1x1').split('x');
      const casterW = parseInt(parts[0]) || 1;
      const tokenX = casterToken.position_x + casterW;
      const tokenY = casterToken.position_y;
      const summonAvatar = summonToken.avatarPath ? getAssetUrl(summonToken.avatarPath) : undefined;
      const summonTokenSize = summonToken.tokenSize || '1x1';
      try {
        await apiFetch('/api/tokens', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaign_id: parseInt(opts?.campaignId || '0'),
            map_url: opts?.currentMapUrl,
            position_x: tokenX,
            position_y: tokenY,
            instance_name: summonToken.instanceName || spell.name,
            item_data: {
              type: summonToken.itemType || 'illusion',
              spell_id: spell.id,
              ...(summonAvatar ? { icon: summonAvatar, avatar_url: summonAvatar, avatar_url_large: summonAvatar } : {}),
              description: summonToken.description || spell.description || '',
              caster_id: characterId,
              ...(summonToken.monsterId ? { monster_id: summonToken.monsterId } : {}),
              ...(summonToken.itemData || {}),
            },
            token_size: summonTokenSize,
          }),
          userId: opts?.userId,
        });
      } catch { /* ignore */ }
    }
    if (level > 0 && !opts?.freecast && !ritualCast) {
      publishAppEvent("consumeSpellSlot", { level, characterId });
    }
    publishAppEvent("spellCastChat", {
      message: `🐴 施放【${spell.name}】，召唤出一个幻术造物！`,
      characterId,
    });
    useSpellSoundStore.getState().playSpellSound(spell.id, 'cast', undefined);
    opts?.onClose?.();
    return;
  }

  // Area or single-target → dispatch to map for targeting
  const spellOption = spellToSpellOption(spell, opts?.spellSaveDC);
  // Override area size for sizeIsMax spells (from opts)
  const areaOverride = opts?.areaSize;
  if (areaOverride != null && spellOption.areaOfEffect) {
    spellOption.areaOfEffect = { ...spellOption.areaOfEffect, size: areaOverride };
  }

  // Misty Step / self-teleport: reuse the area placement picker as a
  // destination picker. Synthesize a 1-grid sphere whose effective range is
  // the teleport range, so the existing range gate works from caster to the
  // clicked cell. Markers let `useMapAreaSpellCastExecutionController`
  // detect this and call `/api/spells/cast` with `teleport_destination`
  // instead of resolving as a normal area spell.
  if (tm === 'teleport_destination') {
    const phases: any[] = Array.isArray(spell.effects) ? spell.effects : [];
    let teleportRangeFeet = 30;
    for (const phase of phases) {
      const leaves = Array.isArray(phase?.effects) ? phase.effects : [];
      for (const leaf of leaves) {
        if (leaf?.type === 'teleport' && Number(leaf.range) > 0) {
          teleportRangeFeet = Number(leaf.range);
        }
      }
    }
    spellOption.range = `${teleportRangeFeet} 尺`;
    spellOption.areaOfEffect = { type: 'sphere', size: 5 };
    (spellOption as any).__teleportDestination = true;
    (spellOption as any).__teleportRange = teleportRangeFeet;
  }

  // 召唤系法术 (无 areaOfEffect) 也走 area 模式，让地图进入空地放置流程。
  const fallbackArea = !!area || isSummonSpellLike(spell);
  const mode = tm
    ? (['area', 'self_emanation', 'touch_area', 'teleport_destination'].includes(tm) ? 'area' : 'single')
    : (fallbackArea ? 'area' : 'single');
  publishAppEvent("startSpellTargeting", {
    spell: spellOption,
    slotLevel: level,
    characterId,
    mode,
    freecast: opts?.freecast,
    ritualCast,
    illusionImageUrl: opts?.illusionImageUrl,
    illusionDesc: opts?.illusionDesc,
    illusionDisplayName: opts?.illusionDisplayName,
    selectedOption: opts?.selectedOption,
    materialId: opts?.materialId,
    longCast: isLongCast,
    confirmBreakConcentration: opts?.confirmBreakConcentration,
  });
  opts?.onClose?.();
}
