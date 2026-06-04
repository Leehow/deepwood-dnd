import { getSpellEffectPhases } from "~/components/spell/spell-constants";
import { getEffectDefinition } from "~/hooks/useEffectSystem";

export type RollModifier = "advantage" | "disadvantage" | null;

type DiceCheck = {
  type?: string | null;
  ability?: string | null;
  skill?: string | null;
  dice?: string | null;
};

type StatusEffectLike = {
  id?: string;
  name?: string;
  condition?: string;
  modifiers?: Array<{
    type?: string;
    target?: string;
    condition?: Record<string, unknown>;
  }>;
};

type RawModifierLike = {
  type?: string;
  target?: string;
  on?: string;
  condition?: Record<string, unknown>;
};

const ABILITY_IDS = new Set([
  "strength",
  "dexterity",
  "constitution",
  "intelligence",
  "wisdom",
  "charisma",
]);

const SAVE_PARAM_TO_ABILITY: Record<string, string> = {
  str_save: "strength",
  dex_save: "dexterity",
  con_save: "constitution",
  int_save: "intelligence",
  wis_save: "wisdom",
  cha_save: "charisma",
};

function extractConditionIds(rawConditions: unknown): string[] {
  if (!Array.isArray(rawConditions)) return [];
  return rawConditions
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && typeof (entry as { condition?: unknown }).condition === "string") {
        return (entry as { condition: string }).condition;
      }
      return null;
    })
    .filter((value): value is string => Boolean(value));
}

function extractStatusCollections(statusEffects: unknown) {
  const source = statusEffects && typeof statusEffects === "object"
    ? (statusEffects as Record<string, unknown>)
    : {};

  const customEffects = Array.isArray(source.custom_effects)
    ? source.custom_effects
    : Array.isArray(source.effects)
      ? source.effects
      : [];

  const conditions = extractConditionIds(
    Array.isArray(source.active_conditions) ? source.active_conditions : source.conditions,
  );

  const exhaustionLevel = typeof source.exhaustion_level === "number"
    ? source.exhaustion_level
    : Number(source.exhaustion_level || 0);

  return {
    customEffects,
    conditions,
    exhaustionLevel: Number.isFinite(exhaustionLevel) ? exhaustionLevel : 0,
  };
}

function mapCustomParam(param: string): { target: string; condition?: Record<string, unknown> } | null {
  if (!param) return null;

  if (param === "all_checks") {
    return { target: "ability_check" };
  }

  if (ABILITY_IDS.has(param)) {
    return { target: "ability_check", condition: { ability: param } };
  }

  if (param in SAVE_PARAM_TO_ABILITY) {
    return { target: "saving_throw", condition: { ability: SAVE_PARAM_TO_ABILITY[param] } };
  }

  if (param === "all_saves") {
    return { target: "saving_throw" };
  }

  if (
    !["ac", "hp_max", "damage", "speed", "attack", "being_attacked", "initiative"].includes(param)
  ) {
    return { target: "ability_check", condition: { skill: param } };
  }

  return null;
}

function buildCustomInlineEffects(rawEffects: unknown): StatusEffectLike[] {
  if (!Array.isArray(rawEffects)) return [];

  return rawEffects.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];

    const effect = entry as Record<string, unknown>;
    const modifiers = Array.isArray(effect.modifiers) ? effect.modifiers : [];

    const inlineModifiers = modifiers.flatMap((modifier) => {
      if (!modifier || typeof modifier !== "object") return [];
      const mod = modifier as Record<string, unknown>;
      const type = typeof mod.type === "string" ? mod.type : "bonus";
      if (type !== "advantage" && type !== "disadvantage") return [];

      const param = typeof mod.param === "string" ? mod.param : "";
      const mapped = mapCustomParam(param);
      if (!mapped) return [];

      return [{
        type,
        target: mapped.target,
        condition: mapped.condition,
      }];
    });

    if (inlineModifiers.length === 0) return [];

    return [{
      id: `custom_status_${String(effect.id || index)}`,
      name: typeof effect.name === "string" ? effect.name : "自定义状态",
      modifiers: inlineModifiers,
    }];
  });
}

function buildConditionEffects(conditionIds: string[]): StatusEffectLike[] {
  return conditionIds.map((conditionId) => ({
    id: conditionId,
    condition: conditionId,
  }));
}

function normalizeInlineModifier(rawModifier: unknown): Array<{
  type?: string;
  target?: string;
  condition?: Record<string, unknown>;
}> {
  if (!rawModifier || typeof rawModifier !== "object") return [];

  const modifier = rawModifier as RawModifierLike;
  const rawType = modifier.type;
  const type = rawType === "grant_advantage"
    ? "advantage"
    : rawType === "grant_disadvantage"
      ? "disadvantage"
      : rawType;
  if (type !== "advantage" && type !== "disadvantage") return [];

  const target = typeof modifier.target === "string"
    ? modifier.target
    : typeof modifier.on === "string"
      ? modifier.on
      : undefined;

  if (target !== "ability_check" && target !== "saving_throw") return [];

  return [{
    type,
    target,
    condition: modifier.condition,
  }];
}

function buildTokenActiveEffects(rawEffects: unknown): StatusEffectLike[] {
  if (!Array.isArray(rawEffects)) return [];

  return rawEffects.flatMap((entry, index) => {
    if (!entry || typeof entry !== "object") return [];

    const effect = entry as Record<string, unknown>;
    const explicitModifiers = Array.isArray(effect.modifiers)
      ? effect.modifiers.flatMap((modifier) => normalizeInlineModifier(modifier))
      : [];

    if (explicitModifiers.length > 0) {
      return [{
        id: String(effect.id || `token_effect_${index}`),
        name: typeof effect.name === "string" ? effect.name : "状态效果",
        modifiers: explicitModifiers,
      }];
    }

    const spellId = typeof effect.spell_id === "string" ? effect.spell_id : null;
    if (!effect.spell_buff || !spellId) return [];

    const selectedOption = typeof effect.selected_option === "string" ? effect.selected_option : null;
    const runtimeModifiers = getSpellEffectPhases(spellId, selectedOption)
      .flatMap((phase) => {
        if (String(phase?.trigger || "on_cast") !== "on_cast") return [];
        return Array.isArray(phase?.effects) ? phase.effects : [];
      })
      .flatMap((modifier) => normalizeInlineModifier(modifier));

    if (runtimeModifiers.length === 0) return [];

    return [{
      id: String(effect.id || `token_effect_${index}`),
      name: typeof effect.name === "string" ? effect.name : spellId,
      modifiers: runtimeModifiers,
    }];
  });
}

function matchesModifierCondition(
  modifierCondition: Record<string, unknown> | undefined,
  rollCondition: Record<string, unknown> | undefined,
): boolean {
  if (!modifierCondition) return true;
  if (!rollCondition) return true;

  const requiredAbility = modifierCondition.ability;
  const rollAbility = rollCondition.ability;
  if (typeof requiredAbility === "string") {
    if (typeof rollAbility !== "string" || requiredAbility !== rollAbility) return false;
  }

  const requiredSkill = modifierCondition.skill;
  const rollSkill = rollCondition.skill;
  if (typeof requiredSkill === "string") {
    if (typeof rollSkill !== "string" || requiredSkill !== rollSkill) return false;
  }

  return true;
}

function collectRollState(
  effects: StatusEffectLike[],
  target: "ability_check" | "saving_throw",
  rollCondition: Record<string, unknown> | undefined,
) {
  let hasAdvantage = false;
  let hasDisadvantage = false;
  const reasons: string[] = [];

  for (const effect of effects) {
    const definition = getEffectDefinition(effect.id || "") || (effect.condition ? getEffectDefinition(effect.condition) : undefined);
    const modifiers = Array.isArray(effect.modifiers) && effect.modifiers.length > 0
      ? effect.modifiers
      : definition?.modifiers || [];

    if (!Array.isArray(modifiers) || modifiers.length === 0) continue;

    const effectName = effect.name || definition?.name || effect.condition || effect.id || "效果";
    for (const modifier of modifiers) {
      if (!modifier || modifier.target !== target) continue;
      if (!matchesModifierCondition(
        modifier.condition as Record<string, unknown> | undefined,
        rollCondition,
      )) {
        continue;
      }

      if (modifier.type === "advantage") {
        hasAdvantage = true;
        reasons.push(`${effectName}: 优势`);
      } else if (modifier.type === "disadvantage") {
        hasDisadvantage = true;
        reasons.push(`${effectName}: 劣势`);
      }
    }
  }

  return { hasAdvantage, hasDisadvantage, reasons };
}

export function resolveCheckRollModifierFromStatusEffects(
  statusEffects: unknown,
  check: DiceCheck | undefined | null,
  activeEffects?: unknown,
): { rollModifier: RollModifier; reasons: string[] } {
  if (!check) {
    return { rollModifier: null, reasons: [] };
  }

  const diceExpr = String(check.dice || "1d20").toLowerCase();
  if (!diceExpr.includes("d20")) {
    return { rollModifier: null, reasons: [] };
  }

  const { customEffects, conditions, exhaustionLevel } = extractStatusCollections(statusEffects);
  const effects = [
    ...buildConditionEffects(conditions),
    ...buildCustomInlineEffects(customEffects),
    ...buildTokenActiveEffects(activeEffects),
  ];

  const target = check.type === "save" ? "saving_throw" : "ability_check";
  const rollCondition = check.type === "save"
    ? (check.ability ? { ability: check.ability } : undefined)
    : {
        ...(check.ability ? { ability: check.ability } : {}),
        ...(check.skill ? { skill: check.skill } : {}),
      };

  const state = collectRollState(effects, target, rollCondition);

  if (target === "ability_check" && exhaustionLevel >= 1) {
    state.hasDisadvantage = true;
    state.reasons.push(`力竭${exhaustionLevel}级: 劣势`);
  }

  if (target === "saving_throw" && exhaustionLevel >= 3) {
    state.hasDisadvantage = true;
    state.reasons.push(`力竭${exhaustionLevel}级: 劣势`);
  }

  if (state.hasAdvantage && state.hasDisadvantage) {
    return { rollModifier: null, reasons: state.reasons };
  }

  if (state.hasAdvantage) {
    return { rollModifier: "advantage", reasons: state.reasons };
  }

  if (state.hasDisadvantage) {
    return { rollModifier: "disadvantage", reasons: state.reasons };
  }

  return { rollModifier: null, reasons: state.reasons };
}

export function mergeRollModifiers(...modifiers: Array<RollModifier | undefined>): RollModifier {
  const hasAdvantage = modifiers.some((modifier) => modifier === "advantage");
  const hasDisadvantage = modifiers.some((modifier) => modifier === "disadvantage");

  if (hasAdvantage && hasDisadvantage) return null;
  if (hasAdvantage) return "advantage";
  if (hasDisadvantage) return "disadvantage";
  return null;
}
