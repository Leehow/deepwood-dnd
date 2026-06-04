/**
 * Granted Actions — 从法术 effects 中提取 grant_action，供角色卡/快捷栏/右键菜单使用
 */
import spellsData from '~/data/rules/spells.json';
import type { GrantActionEffect, ScalingConfig } from '~/types/spellEffect';
import type { AttachedRuntimeRef, GrantedRuntimeAction } from '~/components/map/types/TacticalMapTypes';
import { publishAppEvent } from "~/events/appEventBus";

/** Minimal SpellOption shape for context menu integration (avoids circular import) */
interface SpellOptionLike {
  id: string; name: string; level: number;
  damage?: string; damageType?: string;
  attackType?: string; saveType?: string;
  range?: string;
  areaOfEffect?: { type?: string; size?: number };
  __runtimeAction?: Record<string, any>;
  __activeEffectGrantAction?: ActiveEffectGrantActionMeta;
}

/** Metadata for a `grant_action` entry persisted on a token's
 * `active_effects` (e.g. Witch Bolt repeat damage). Carried through the
 * targeting flow so the sidebar controller can route execution to the
 * dedicated `/api/spells/granted-actions/execute` endpoint instead of
 * the standard spell cast path. */
export interface ActiveEffectGrantActionMeta {
  effectId?: string;
  spellId: string;
  spellName: string;
  actionKind: string;
  actionName: string;
  targetTokenId?: number;
  sourceTokenId?: number;
}

// ── 导出接口 ──

/** 一个可执行的法术授予动作（附带来源法术信息） */
export interface GrantedAction {
  /** grant_action 原始数据（camelCase） */
  effect: GrantActionEffect;
  /** 来源法术 */
  spellId: string;
  spellName: string;
  /** 实际消耗的环位（用于 scaling 计算） */
  slotLevel: number;
  /** 来自后端 runtime projection 的动作元数据 */
  runtimeAction?: {
    runtimeInstanceId: number;
    actionId: string;
    sourceTokenId?: number | null;
    available?: boolean;
    requiresTarget?: boolean;
  };
  /** 来自后端 `active_effects` 的 `grant_action` 条目（不走 runtime 引擎） */
  activeEffectGrantAction?: ActiveEffectGrantActionMeta;
}

// ── Action type 显示标签 ──

const ACTION_TYPE_LABELS: Record<string, string> = {
  action: '动作',
  bonus_action: '附赠动作',
  reaction: '反应',
};

/** 不需要选择目标的动作类型。
 *
 * `weapon_attack` (Swift Quiver) 与 `custom` (Compulsion 指定移动方向) 在
 * spells.json 中没有伤害/攻击/豁免元数据，旧的"进入目标选择器"路径会落到
 * damage-only 的 granted-action 执行端点，结果要么静默无操作、要么报
 * "该法术动作没有可执行的伤害定义"。V1 最小可接受行为：把它们当作不需要目标的
 * 声明型动作（消耗动作经济 + 写一条聊天），与 dash/extra_action/command 一致。
 * 真正需要目标/范围的种类 (attack / save_damage / repeat_damage / move_effect /
 * remove_condition / transfer) 不在此集合，保持原有目标/范围行为。 */
const NO_TARGET_KINDS = new Set([
  'dash', 'disengage', 'dodge', 'hide', 'extra_action', 'command',
  'weapon_attack', 'custom',
]);

/** `move_effect` 法术若在 spells.json 中既无 grant 条目 area，也无顶层
 * `areaOfEffect`，落地占位时会退化成默认的 20 尺球。对这类法术按 spell_id 提供
 * 一个具体的小范围形状（仅限确有此需的法术，不是所有 move_effect 的通用默认）。 */
const MOVE_EFFECT_AREA_FALLBACK: Record<string, { type: string; size: number }> = {
  flaming_sphere: { type: 'sphere', size: 5 },
};

/** 动作种类的默认描述 */
const ACTION_KIND_DESC: Record<string, string> = {
  dash: '本回合移动速度翻倍',
  disengage: '本回合移动不会引发借机攻击',
  dodge: '针对你的攻击骰具有劣势，你的敏捷豁免具有优势',
  hide: '进行敏捷（隐匿）检定尝试躲藏',
  extra_action: '获得一个额外动作',
  command: '指挥召唤物执行动作',
  melee_spell_attack: '近战法术攻击',
  ranged_spell_attack: '远程法术攻击',
  repeat_damage: '对已锁定目标重复造成伤害',
  move_effect: '移动法术效果到新位置',
  weapon_attack: '发动一次武器攻击',
  custom: '执行该法术的特殊动作',
  remove_condition: '解除目标身上的状态',
};

// ── snake_case → camelCase 转换 ──

function normalizeGrantAction(raw: any): GrantActionEffect {
  return {
    type: 'grant_action',
    actionType: raw.action_type || raw.actionType,
    actionName: raw.action_name || raw.actionName || '',
    actionNameEn: raw.action_name_en || raw.actionNameEn,
    icon: raw.icon,
    actionKind: raw.action_kind || raw.actionKind,
    attack: raw.attack,
    save: raw.save ? {
      ability: raw.save.ability,
      onSuccess: raw.save.on_success || raw.save.onSuccess,
      onFailure: raw.save.on_failure || raw.save.onFailure,
    } : undefined,
    damage: raw.damage ? {
      formula: raw.damage.formula,
      damageType: raw.damage.damage_type || raw.damage.damageType,
    } : undefined,
    healing: raw.healing,
    movement: raw.movement,
    areaOfEffect: raw.area_of_effect || raw.areaOfEffect,
    attackCount: raw.attack_count || raw.attackCount,
    commandRange: raw.command_range || raw.commandRange,
    allowedActions: raw.allowed_actions || raw.allowedActions,
    triggerCondition: raw.trigger_condition || raw.triggerCondition,
    scaling: raw.scaling ? {
      perSlotAbove: raw.scaling.per_slot_above || raw.scaling.perSlotAbove,
      extraDice: raw.scaling.extra_dice || raw.scaling.extraDice,
      extraTargets: raw.scaling.extra_targets || raw.scaling.extraTargets,
      extraDuration: raw.scaling.extra_duration || raw.scaling.extraDuration,
      extraValue: raw.scaling.extra_value || raw.scaling.extraValue,
    } as ScalingConfig : undefined,
    description: raw.description,
  };
}

/**
 * Normalize a `grant_action` entry persisted on `token.active_effects` (e.g.
 * the Witch Bolt follow-up action written by the backend
 * `GrantActionHandler`). Unlike runtime projections these carry no
 * `runtime_instance_id` / `action_id`, so they execute through the static
 * grant-action targeting path (`startSpellTargeting` with a synthesized
 * spell option) rather than the runtime-actions endpoint.
 */
function normalizeActiveEffectGrantAction(raw: any): GrantedAction | null {
  if (!raw || raw.effect_type !== 'grant_action') return null;
  const spellId: string = raw.spell_id || '';
  const spellName: string = raw.source || raw.name || spellId;
  if (!spellId) return null;
  const effect = normalizeGrantAction(raw);
  const meta: ActiveEffectGrantActionMeta = {
    effectId: typeof raw.id === 'string' ? raw.id : undefined,
    spellId,
    spellName,
    actionKind: effect.actionKind,
    actionName: effect.actionName,
    targetTokenId: typeof raw.target_token_id === 'number' ? raw.target_token_id : undefined,
    sourceTokenId: typeof raw.source_token_id === 'number' ? raw.source_token_id : undefined,
  };
  return {
    effect,
    spellId,
    spellName,
    slotLevel: typeof raw.slot_level === 'number' ? raw.slot_level : 0,
    activeEffectGrantAction: meta,
  };
}

function normalizeRuntimeGrantedAction(raw: GrantedRuntimeAction): GrantedAction {
  const runtimeAction = raw.source === 'runtime' ? {
    runtimeInstanceId: raw.runtime_instance_id,
    actionId: raw.action_id,
    sourceTokenId: raw.source_token_id ?? null,
    available: raw.available,
    requiresTarget: raw.requires_target,
  } : undefined;
  return {
    effect: {
      type: 'grant_action',
      actionType: raw.action_type || 'bonus_action',
      actionName: raw.action_name || raw.spell_name,
      actionNameEn: raw.action_name_en || undefined,
      icon: raw.icon || undefined,
      actionKind: raw.action_kind || 'command',
      description: raw.description || undefined,
    },
    spellId: raw.spell_id,
    spellName: raw.spell_name,
    slotLevel: raw.slot_level ?? 0,
    runtimeAction,
  };
}

function getProjectedActionSemanticKey(action: Pick<GrantedAction, "spellId" | "effect">): string {
  return [
    action.spellId,
    action.effect.actionName,
    action.effect.actionKind || '',
    action.effect.actionType || '',
  ].join(':');
}

// ── 核心提取函数 ──

/** 从 spell_id 提取该法术授予的所有动作 */
export function extractGrantedActions(
  spellId: string,
  slotLevel?: number,
): GrantedAction[] {
  const allSpells = (spellsData as any).spells || spellsData;
  const spell = (Array.isArray(allSpells) ? allSpells : []).find((s: any) => s.id === spellId);
  if (!spell?.effects) return [];

  const actions: GrantedAction[] = [];
  for (const phase of spell.effects) {
    if (!Array.isArray(phase.effects)) continue;
    for (const eff of phase.effects) {
      if (eff.type === 'grant_action') {
        actions.push({
          effect: normalizeGrantAction(eff),
          spellId,
          spellName: spell.name,
          slotLevel: slotLevel ?? spell.level ?? 0,
        });
      }
    }
  }
  return actions;
}

/** 从专注法术 + 被施加buff 列表中提取全部可用动作 */
export function extractAllGrantedActions(
  concentrationSpell?: { spell_id: string; slot_level: number } | null,
  incomingSpellBuffs?: Array<{ id: string; spell_id?: string }>,
  runtimeActions?: GrantedRuntimeAction[] | null,
  attachedRuntimeRefs?: AttachedRuntimeRef[] | null,
  selfActiveEffectGrantActions?: Array<Record<string, any>> | null,
): GrantedAction[] {
  const actions: GrantedAction[] = [];
  const seen = new Set<string>();
  const projectedActionKeys = new Set<string>();
  const runtimeBackedSpellIds = new Set(
    (attachedRuntimeRefs || [])
      .filter((ref) => ref?.role === 'source' && !!ref.spell_id)
      .map((ref) => ref.spell_id),
  );

  // Split projected actions into true runtime-backed entries and legacy
  // projections so active-effect entries can win over the legacy projection
  // (which carries no `effect_id` / locked target) while still deferring to
  // real runtime actions.
  const runtimeBackedActions: GrantedRuntimeAction[] = [];
  const legacyProjectedActions: GrantedRuntimeAction[] = [];
  if (runtimeActions) {
    for (const raw of runtimeActions) {
      if (raw.available === false) continue;
      if (raw.source === 'runtime') runtimeBackedActions.push(raw);
      else legacyProjectedActions.push(raw);
    }
  }

  // 1. True runtime-backed projections (authoritative — bind to a real
  //    `runtime_instance_id` / `action_id`).
  for (const rawAction of runtimeBackedActions) {
    const action = normalizeRuntimeGrantedAction(rawAction);
    const semanticKey = getProjectedActionSemanticKey(action);
    projectedActionKeys.add(semanticKey);
    const key = `runtime:${rawAction.runtime_instance_id}:${rawAction.action_id}`;
    if (!seen.has(key)) { seen.add(key); actions.push(action); }
  }

  // 2. From backend-persisted `grant_action` entries on the source token's
  //    own active_effects (e.g. Witch Bolt repeat-damage written by
  //    `GrantActionHandler`). Must beat legacy projections — those carry no
  //    `effect_id` / locked `target_token_id`, so the granted-actions execute
  //    endpoint cannot route on them.
  if (selfActiveEffectGrantActions) {
    for (const raw of selfActiveEffectGrantActions) {
      const action = normalizeActiveEffectGrantAction(raw);
      if (!action) continue;
      if (runtimeBackedSpellIds.has(action.spellId)) continue;
      const key = getProjectedActionSemanticKey(action);
      if (projectedActionKeys.has(key)) continue; // runtime-backed wins
      projectedActionKeys.add(key);
      if (!seen.has(key)) { seen.add(key); actions.push(action); }
    }
  }

  // 3. Legacy projections — only when nothing more authoritative covered
  //    the semantic key.
  for (const rawAction of legacyProjectedActions) {
    const action = normalizeRuntimeGrantedAction(rawAction);
    const semanticKey = getProjectedActionSemanticKey(action);
    if (projectedActionKeys.has(semanticKey)) continue;
    projectedActionKeys.add(semanticKey);
    const key = `legacy:${semanticKey}`;
    if (!seen.has(key)) { seen.add(key); actions.push(action); }
  }

  // 从专注法术提取
  if (concentrationSpell?.spell_id && !runtimeBackedSpellIds.has(concentrationSpell.spell_id)) {
    const items = extractGrantedActions(
      concentrationSpell.spell_id,
      concentrationSpell.slot_level,
    );
    for (const a of items) {
      const key = getProjectedActionSemanticKey(a);
      if (projectedActionKeys.has(key)) continue;
      if (!seen.has(key)) { seen.add(key); actions.push(a); }
    }
  }

  // 从被施加的法术buff提取
  if (incomingSpellBuffs) {
    for (const buff of incomingSpellBuffs) {
      const sid = buff.spell_id || buff.id.replace('spell_buff_', '');
      if (!sid) continue;
      if (runtimeBackedSpellIds.has(sid)) continue;
      const items = extractGrantedActions(sid);
      for (const a of items) {
        const key = getProjectedActionSemanticKey(a);
        if (projectedActionKeys.has(key)) continue;
        if (!seen.has(key)) { seen.add(key); actions.push(a); }
      }
    }
  }

  return actions;
}

// ── 转换为 SpellOption（供右键菜单复用） ──

export function grantedActionToSpellOption(action: GrantedAction): SpellOptionLike {
  const e = action.effect;
  const allSpells = (spellsData as any).spells || spellsData;
  const spell = (Array.isArray(allSpells) ? allSpells : []).find((s: any) => s.id === action.spellId);
  // Moving-area grants (Moonbeam / Flaming Sphere) typically omit
  // `area_of_effect` on the grant entry itself. Precedence: explicit grant
  // shape → source spell top-level shape (Moonbeam = cylinder/5) → per-spell
  // fallback for spells that carry no top-level shape at all (Flaming Sphere =
  // sphere/5). The explicit shape always wins.
  const isMoveEffect = e.actionKind === 'move_effect';
  const areaShape = e.areaOfEffect
    || (isMoveEffect && spell?.areaOfEffect ? spell.areaOfEffect : undefined)
    || (isMoveEffect ? MOVE_EFFECT_AREA_FALLBACK[action.spellId] : undefined);
  return {
    id: `granted_${action.spellId}_${e.actionKind}`,
    name: `${e.icon || '✦'} ${e.actionName}`,
    level: 0, // 不消耗法术位
    damage: e.damage?.formula,
    damageType: e.damage?.damageType,
    attackType: e.attack?.type,
    saveType: e.save?.ability,
    range: e.movement ? `${e.movement.range}尺` : spell?.range,
    areaOfEffect: areaShape ? { type: areaShape.type, size: areaShape.size } : undefined,
    ...(action.runtimeAction ? { __runtimeAction: action.runtimeAction } : {}),
    ...(action.activeEffectGrantAction
      ? { __activeEffectGrantAction: action.activeEffectGrantAction }
      : {}),
  };
}

// ── 执行逻辑 ──

/** 判断此动作是否需要选目标 */
export function actionNeedsTarget(action: GrantedAction): boolean {
  if (typeof action.runtimeAction?.requiresTarget === 'boolean') {
    return action.runtimeAction.requiresTarget;
  }
  return !NO_TARGET_KINDS.has(action.effect.actionKind);
}

/** 执行法术授予动作 */
export function executeGrantedAction(
  action: GrantedAction,
  characterId: number,
  campaignId?: string,
  sourceTokenId?: number,
) {
  const e = action.effect;

  // 扣减战斗动作经济（CombatPanel 监听 combatActionUsed 事件）
  if (e.actionType) {
    publishAppEvent("combatActionUsed", { type: e.actionType });
  }
  // 疾走特殊处理：除了消耗动作类型，还要增加移动距离
  if (e.actionKind === 'dash') {
    publishAppEvent("combatActionUsed", { type: 'dash' });
  }

  if (actionNeedsTarget(action)) {
    // 需要目标 → 进入地图选目标模式
    const spellOption = grantedActionToSpellOption(action);
    // `move_effect` always relocates an area, even when the source spell has no
    // explicit shape (e.g. Flaming Sphere) — route it through area placement.
    const mode = (e.actionKind === 'move_effect' || e.areaOfEffect || spellOption.areaOfEffect)
      ? 'area'
      : 'single';
    publishAppEvent("startSpellTargeting", {
      spell: spellOption,
      slotLevel: 0,
      characterId,
      sourceTokenId: sourceTokenId ?? action.runtimeAction?.sourceTokenId,
      mode,
      freecast: true,
      isGrantedAction: true,
      sourceSpellName: action.spellName,
      runtimeAction: action.runtimeAction,
    });
  } else {
    // 不需要目标 → 通过 spellCastChat 广播聊天消息
    const msg = buildNoTargetMessage(action);
    publishAppEvent("spellCastChat", { message: msg, characterId });
  }
}

function buildNoTargetMessage(action: GrantedAction): string {
  const e = action.effect;
  const typeLabel = ACTION_TYPE_LABELS[e.actionType] || e.actionType;
  switch (e.actionKind) {
    case 'dash':
      return `使用${action.spellName}的附赠动作执行了**疾走**（速度翻倍本回合）`;
    case 'disengage':
      return `使用${action.spellName}的附赠动作执行了**撤离**（移动不会引发借机攻击）`;
    case 'dodge':
      return `使用${action.spellName}的附赠动作执行了**闪避**（攻击骰对你具有劣势）`;
    case 'hide':
      return `使用${action.spellName}的附赠动作执行了**躲藏**`;
    case 'extra_action':
      return `使用${action.spellName}获得了一个**额外动作**（${typeLabel}）`;
    case 'command':
      return `使用${typeLabel}**指挥**${action.spellName}的召唤物`;
    case 'weapon_attack':
      return `使用${action.spellName}发动**${e.actionName}**（${typeLabel}·武器攻击）`;
    case 'custom': {
      const detail = e.description ? `：${e.description}` : '';
      return `使用${action.spellName}执行**${e.actionName}**（${typeLabel}）${detail}`;
    }
    default:
      return `执行了${action.spellName}的 ${e.actionName}（${typeLabel}）`;
  }
}

/** 获取动作类型的中文标签 */
export function getActionTypeLabel(actionType: string): string {
  return ACTION_TYPE_LABELS[actionType] || actionType;
}

/** 获取动作的简短描述 */
export function getActionSummary(action: GrantedAction): string {
  const e = action.effect;
  if (e.description) return e.description;
  const parts: string[] = [];
  if (e.damage) parts.push(`${e.damage.formula} ${e.damage.damageType}`);
  if (e.healing) parts.push(`治疗 ${e.healing.formula}`);
  if (e.movement) parts.push(`移动${e.movement.range}尺`);
  if (e.save) parts.push(`${e.save.ability.toUpperCase()}豁免`);
  if (e.attack) parts.push(e.attack.type === 'melee_spell' ? '近战法术攻击' : '远程法术攻击');
  if (parts.length > 0) return parts.join(' / ');
  // 根据 actionKind 返回默认描述
  return ACTION_KIND_DESC[e.actionKind] || action.spellName;
}
