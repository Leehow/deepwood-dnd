/**
 * FeatureDetailDialog - 职业技能/特性详情弹窗
 * 共享组件，可用于角色卡、快捷栏等任何需要展示职业特性详情的地方
 */
import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { SpellSlotInfo } from '~/components/hotbar/Hotbar';
import { getAssetUrl } from '~/utils/asset-url';
import { dispatchOpenEvent } from '~/utils/openEventBridge';

export interface FeatureDetailInfo {
  name: string;
  nameEn?: string;
  level?: number;
  source?: string;
  description?: string;
  icon?: string;
}

export interface FeatureResourceInfo {
  id?: string;
  current: number;
  max: number;
  maxFormula: string;
  rechargeType?: string;
}

interface AbilityScoresPartial {
  charisma?: number;
  wisdom?: number;
  intelligence?: number;
}

export function getResourceFormulaText(
  maxFormula: string,
  max: number,
  abilities: AbilityScoresPartial,
  level: number,
): string {
  const getMod = (score: number) => Math.floor((score - 10) / 2);
  const fmt = (v: number) => `${v >= 0 ? '+' : ''}${v}`;
  const cha = abilities.charisma ?? 10;
  const wis = abilities.wisdom ?? 10;
  const int = abilities.intelligence ?? 10;
  switch (maxFormula) {
    case 'cha_mod': return `魅力调整值(${fmt(getMod(cha))}) = ${max}`;
    case 'cha_mod_plus_1': return `1 + 魅力调整值(${fmt(getMod(cha))}) = ${max}`;
    case 'wis_mod': return `感知调整值(${fmt(getMod(wis))}) = ${max}`;
    case 'int_mod': return `智力调整值(${fmt(getMod(int))}) = ${max}`;
    case 'level_times_5': return `职业等级(${level}) × 5 = ${max}`;
    case 'level': return `职业等级 = ${max}`;
    case 'half_level_rounded_up': return `职业等级(${level}) ÷ 2 向上取整 = ${max}`;
    case 'fixed': return `固定值 = ${max}`;
    default: return `${max}`;
  }
}

interface FeatureDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feature: FeatureDetailInfo | null;
  resource?: FeatureResourceInfo | null;
  execution?: Record<string, any> | null;
  spellSlotInfo?: SpellSlotInfo | null;
  abilityScores?: AbilityScoresPartial;
  characterLevel?: number;
  /** Character ID for dispatching dedicated modal events (arcane recovery etc.) */
  characterId?: number;
  /** Optional selection text to display (e.g. "龙类" for Favored Enemy) */
  selectionText?: string;
  /** Callback to use a resource charge. Returns updated current value. */
  onUseResource?: (resourceId: string, amount: number) => Promise<number | null>;
  /** DM mode: allow direct editing of resource value */
  isDM?: boolean;
  /** DM callback: set resource to absolute value. Returns updated current value. */
  onSetResource?: (resourceId: string, value: number) => Promise<number | null>;
  /** Callback to enter targeting mode for abilities like lay_on_hands. Closes dialog. */
  onStartTargeting?: (resourceId: string, poolCurrent: number, poolMax: number) => void;
  /** Callback to enter targeting mode for divine smite with spell slot level. */
  onStartSmiteTargeting?: (resourceId: string, spellSlotLevel: number) => void;
  /** Callback to consume a spell slot (for spell_slots-type resources like primeval_awareness). */
  onConsumeSpellSlot?: (level: number, resourceId: string) => void;
  /** Callback for at-will cast (invocations that can be cast at will, no resource needed). */
  onAtWillCast?: () => void;
  /** Label for at-will cast button */
  atWillCastLabel?: string;
}

const SMITE_TARGETING_RESOURCES = ['divine_smite'];

export function FeatureDetailDialog({
  open,
  onOpenChange,
  feature,
  resource,
  execution,
  spellSlotInfo,
  abilityScores,
  characterLevel = 1,
  characterId,
  selectionText,
  onUseResource,
  isDM,
  onSetResource,
  onStartTargeting,
  onStartSmiteTargeting,
  onConsumeSpellSlot,
  onAtWillCast,
  atWillCastLabel,
}: FeatureDetailDialogProps) {
  const [localCurrent, setLocalCurrent] = useState<number | null>(null);
  const [using, setUsing] = useState(false);
  const [setting, setSetting] = useState(false);
  const [selectedSlotLevel, setSelectedSlotLevel] = useState<number>(1);

  // Reset local state when dialog opens/closes or resource changes
  const displayCurrent = localCurrent ?? resource?.current ?? 0;

  const needsDedicatedModal = Boolean(execution?.openEvent);

  const canUse = resource && resource.id && displayCurrent > 0 && (onUseResource || onStartTargeting || needsDedicatedModal);

  if (!feature) return null;

  const rechargeLabel = resource?.rechargeType === 'short_rest' ? '短休恢复'
    : resource?.rechargeType === 'long_rest' ? '长休恢复' : null;

  // Resources that need targeting mode instead of simple consumption
  const TARGETING_RESOURCES = ['lay_on_hands'];
  const needsTargeting = resource?.id && TARGETING_RESOURCES.includes(resource.id) && onStartTargeting;

  // Smite-type resources: need spell slot selection + targeting
  const needsSmiteTargeting = resource?.id && SMITE_TARGETING_RESOURCES.includes(resource.id)
    && resource.maxFormula === 'spell_slots' && spellSlotInfo && onStartSmiteTargeting;

  // Non-smite spell_slots resources: just consume a spell slot (e.g. primeval_awareness)
  const needsSpellSlotConsume = resource?.id && resource.maxFormula === 'spell_slots'
    && !SMITE_TARGETING_RESOURCES.includes(resource.id) && spellSlotInfo && onConsumeSpellSlot;

  const handleUse = async () => {
    if (!resource?.id) return;
    // Dedicated modal resources: dispatch event and close dialog
    if (needsDedicatedModal) {
      const eventName = execution?.openEvent;
      if (!eventName) return;
      dispatchOpenEvent(eventName, {
        sourceCharacterId: characterId,
        resourceId: resource.id,
        execution,
      });
      onOpenChange(false);
      return;
    }
    // Targeting-based resources: enter targeting mode and close dialog
    if (needsTargeting) {
      onStartTargeting!(resource.id, displayCurrent, resource.max);
      onOpenChange(false);
      return;
    }
    if (!onUseResource) return;
    setUsing(true);
    try {
      const newCurrent = await onUseResource(resource.id, 1);
      if (newCurrent !== null) setLocalCurrent(newCurrent);
    } finally {
      setUsing(false);
    }
  };

  const handleSmiteTarget = () => {
    if (!resource?.id || !onStartSmiteTargeting) return;
    onStartSmiteTargeting(resource.id, selectedSlotLevel);
    onOpenChange(false);
  };

  const handleSpellSlotUse = () => {
    if (!onConsumeSpellSlot || !spellSlotInfo || !resource?.id) return;
    if ((spellSlotInfo.remaining[selectedSlotLevel] ?? 0) <= 0) return;
    onConsumeSpellSlot(selectedSlotLevel, resource.id);
    onOpenChange(false);
  };

  const handleSetValue = async (newValue: number) => {
    if (!resource?.id || !onSetResource) return;
    const clamped = Math.max(0, Math.min(newValue, resource.max));
    setSetting(true);
    try {
      const result = await onSetResource(resource.id, clamped);
      if (result !== null) setLocalCurrent(result);
    } finally {
      setSetting(false);
    }
  };

  // Compute damage dice for divine smite preview
  const smiteDice = (level: number) => Math.min(1 + level, 5);

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) { setLocalCurrent(null); setSelectedSlotLevel(1); } onOpenChange(v); }}>
      <Dialog.Portal container={typeof document !== 'undefined' ? document.body : undefined}>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[210]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[92vw] max-w-md max-h-[80dvh] bg-gray-900 border border-gray-700 rounded-lg
          flex flex-col z-[211] shadow-2xl overflow-hidden">
          <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-700/60 flex-shrink-0">
            <Dialog.Title className="text-sm font-semibold text-gray-200">
              {feature.name}
            </Dialog.Title>
            <Dialog.Close className="w-8 h-8 flex items-center justify-center rounded
              bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="space-y-3 text-sm text-gray-300">
              {/* Header: icon + name + resource count */}
              <div className="flex items-center gap-2">
                {resource?.id ? (
                  <img
                    src={getAssetUrl(`assets/class-feature-icons/${resource.id}.png`)}
                    alt=""
                    className="w-10 h-10 rounded-lg flex-shrink-0 object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <span className="text-2xl">{feature.icon || '★'}</span>
                )}
                <div className="flex-1">
                  <div className="font-medium text-gray-100">{feature.name}</div>
                  <div className="text-xs text-gray-500">
                    {[feature.nameEn, feature.level != null && `${feature.level}级`, feature.source].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {resource && !needsSmiteTargeting && !needsSpellSlotConsume && (
                  <div className="text-right flex-shrink-0 flex items-center gap-1.5">
                    {isDM && onSetResource && (
                      <button
                        onClick={() => handleSetValue(displayCurrent - 1)}
                        disabled={displayCurrent <= 0 || setting}
                        className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white
                          disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold flex items-center justify-center"
                      >−</button>
                    )}
                    <div className="text-lg font-bold text-amber-400 tabular-nums min-w-[3ch] text-center">
                      {displayCurrent}/{resource.max}
                    </div>
                    {isDM && onSetResource && (
                      <button
                        onClick={() => handleSetValue(displayCurrent + 1)}
                        disabled={displayCurrent >= resource.max || setting}
                        className="w-7 h-7 rounded-md bg-gray-700 hover:bg-gray-600 text-gray-300 hover:text-white
                          disabled:opacity-30 disabled:cursor-not-allowed transition-colors text-sm font-bold flex items-center justify-center"
                      >+</button>
                    )}
                  </div>
                )}
              </div>

              {/* Selection info (e.g. Favored Enemy, Favored Terrain) */}
              {selectionText && (
                <div className="bg-green-900/20 border border-green-700/40 rounded-lg px-3 py-2">
                  <span className="text-xs text-gray-400">已选择：</span>
                  <span className="text-xs text-green-300 font-medium">{selectionText}</span>
                </div>
              )}

              {/* Resource formula breakdown (non-spell-slot resources) */}
              {resource && resource.maxFormula && !needsSmiteTargeting && !needsSpellSlotConsume && (
                <div className="bg-gray-800/60 rounded-lg px-3 py-2 space-y-1">
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">次数上限：</span>
                    {getResourceFormulaText(resource.maxFormula, resource.max, abilityScores || {}, characterLevel)}
                  </div>
                  <div className="text-xs text-gray-400">
                    <span className="text-gray-500">当前剩余：</span>
                    <span className="text-amber-400">{displayCurrent}</span> / {resource.max}
                  </div>
                  {rechargeLabel && (
                    <div className="text-xs text-gray-400">
                      <span className="text-gray-500">恢复方式：</span>{rechargeLabel}
                    </div>
                  )}
                </div>
              )}

              {/* Spell slot selector for divine smite */}
              {needsSmiteTargeting && spellSlotInfo && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400 font-medium">选择法术位环数</div>
                  <div className="space-y-1.5">
                    {[1, 2, 3, 4, 5].map(level => {
                      const max = spellSlotInfo.max[level] ?? 0;
                      const remaining = spellSlotInfo.remaining[level] ?? 0;
                      if (max <= 0) return null;
                      const dice = smiteDice(level);
                      const isSelected = selectedSlotLevel === level;
                      const isEmpty = remaining <= 0;
                      return (
                        <button
                          key={level}
                          onClick={() => !isEmpty && setSelectedSlotLevel(level)}
                          disabled={isEmpty}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all ${
                            isEmpty
                              ? 'border-gray-700/40 bg-gray-800/30 opacity-40 cursor-not-allowed'
                              : isSelected
                                ? 'border-amber-500/60 bg-amber-900/30 ring-1 ring-amber-500/40'
                                : 'border-gray-700/50 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/60'
                          }`}
                        >
                          <span className={`text-base font-bold tabular-nums w-6 text-center ${isSelected ? 'text-amber-400' : 'text-gray-400'}`}>
                            {level}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-300">{level}环位</div>
                            <div className={`text-[11px] ${isSelected ? 'text-amber-300/80' : 'text-gray-500'}`}>
                              {dice}d8 光耀伤害{' '}
                              <span className="text-gray-600">（亡灵/邪魔 +1d8）</span>
                            </div>
                          </div>
                          <div className={`text-xs font-medium tabular-nums ${
                            isEmpty ? 'text-red-400' : isSelected ? 'text-amber-400' : 'text-gray-400'
                          }`}>
                            {remaining}/{max}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Spell slot selector for non-smite spell_slots resources (e.g. primeval_awareness) */}
              {needsSpellSlotConsume && spellSlotInfo && (
                <div className="space-y-2">
                  <div className="text-xs text-gray-400 font-medium">消耗一个法术位来激活</div>
                  <div className="space-y-1.5">
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(level => {
                      const max = spellSlotInfo.max[level] ?? 0;
                      const remaining = spellSlotInfo.remaining[level] ?? 0;
                      if (max <= 0) return null;
                      const isSelected = selectedSlotLevel === level;
                      const isEmpty = remaining <= 0;
                      return (
                        <button
                          key={level}
                          onClick={() => !isEmpty && setSelectedSlotLevel(level)}
                          disabled={isEmpty}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg border text-left transition-all ${
                            isEmpty
                              ? 'border-gray-700/40 bg-gray-800/30 opacity-40 cursor-not-allowed'
                              : isSelected
                                ? 'border-amber-500/60 bg-amber-900/30 ring-1 ring-amber-500/40'
                                : 'border-gray-700/50 bg-gray-800/40 hover:border-gray-600 hover:bg-gray-800/60'
                          }`}
                        >
                          <span className={`text-base font-bold tabular-nums w-6 text-center ${isSelected ? 'text-amber-400' : 'text-gray-400'}`}>
                            {level}
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-gray-300">{level}环位</div>
                          </div>
                          <div className={`text-xs font-medium tabular-nums ${
                            isEmpty ? 'text-red-400' : isSelected ? 'text-amber-400' : 'text-gray-400'
                          }`}>
                            {remaining}/{max}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Description */}
              {feature.description && (
                <p className="text-gray-400 whitespace-pre-wrap">{feature.description}</p>
              )}

              {/* Lay on Hands usage breakdown */}
              {resource?.id === 'lay_on_hands' && (
                <div className="bg-gray-800/60 rounded-lg px-3 py-2 space-y-1.5">
                  <div className="text-xs text-gray-400 font-medium">用途消耗</div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-emerald-400">💚 恢复生命值</span>
                    <span className="text-gray-500">—</span>
                    <span className="text-gray-400">每1点池消耗恢复1HP</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-amber-400">☀️ 对不死生物</span>
                    <span className="text-gray-500">—</span>
                    <span className="text-gray-400">转化为光耀伤害，每1点池消耗造成1点</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-red-400">🚫 对构装体</span>
                    <span className="text-gray-500">—</span>
                    <span className="text-gray-400">无效</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-amber-400">🧪 治愈疾病</span>
                    <span className="text-gray-500">—</span>
                    <span className="text-gray-400">消耗 <span className="text-amber-300 font-medium">5点</span></span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-lime-400">☠️ 中和毒素</span>
                    <span className="text-gray-500">—</span>
                    <span className="text-gray-400">消耗 <span className="text-amber-300 font-medium">5点</span></span>
                  </div>
                </div>
              )}

              {/* Level info */}
              {feature.level != null && (
                <div className="text-xs text-gray-500">获得等级：{feature.level}级</div>
              )}
            </div>
          </div>

          {/* Smite targeting button */}
          {needsSmiteTargeting && spellSlotInfo && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700/60">
              <button
                onClick={handleSmiteTarget}
                disabled={(spellSlotInfo.remaining[selectedSlotLevel] ?? 0) <= 0}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  (spellSlotInfo.remaining[selectedSlotLevel] ?? 0) > 0
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {(spellSlotInfo.remaining[selectedSlotLevel] ?? 0) > 0
                  ? `选择目标（${selectedSlotLevel}环位 · ${smiteDice(selectedSlotLevel)}d8）`
                  : '法术位已用尽'}
              </button>
            </div>
          )}

          {/* Use button for spell_slots resources (non-smite, e.g. primeval_awareness) */}
          {needsSpellSlotConsume && spellSlotInfo && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700/60">
              <button
                onClick={handleSpellSlotUse}
                disabled={(spellSlotInfo.remaining[selectedSlotLevel] ?? 0) <= 0}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  (spellSlotInfo.remaining[selectedSlotLevel] ?? 0) > 0
                    ? 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {(spellSlotInfo.remaining[selectedSlotLevel] ?? 0) > 0
                  ? `使用（消耗${selectedSlotLevel}环位）`
                  : '法术位已用尽'}
              </button>
            </div>
          )}

          {/* Use button for consumable resources (non-smite, non-spell_slots) */}
          {!needsSmiteTargeting && !needsSpellSlotConsume && resource && resource.id && (onUseResource || needsTargeting || needsDedicatedModal) && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700/60">
              <button
                onClick={handleUse}
                disabled={!canUse || using}
                className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                  canUse && !using
                    ? needsDedicatedModal
                      ? 'bg-indigo-600 hover:bg-indigo-500 text-white'
                      : needsTargeting
                        ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        : 'bg-amber-600 hover:bg-amber-500 text-white'
                    : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                }`}
              >
                {using ? '使用中...' : displayCurrent > 0
                  ? needsDedicatedModal
                    ? `选择恢复法术位（剩余 ${displayCurrent}/${resource!.max}）`
                    : needsTargeting
                      ? `选择目标（剩余 ${displayCurrent}/${resource!.max}）`
                      : `使用（剩余 ${displayCurrent}/${resource!.max}）`
                  : '已用尽'}
              </button>
            </div>
          )}
          {/* At-will cast button (for invocations with no resource pool) */}
          {!resource && onAtWillCast && (
            <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700/60">
              <button
                onClick={() => { onAtWillCast(); onOpenChange(false); }}
                className="w-full py-2 rounded-lg text-sm font-medium transition-colors bg-purple-600 hover:bg-purple-500 text-white"
              >
                {atWillCastLabel || '施展'}
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
