import { useState, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { HotbarSlot, Character, EquipmentItem } from '~/components/character/CharacterDisplay/types/Character';
import equipmentJson from '~/data/rules/equipment.json';
import { tDamageType } from '~/utils/i18n/dictionary';

export interface AttackInfo {
  attackBonus: number;
  abilityName: string;
  abilityMod: number;
  profBonus: number;
  isRanged: boolean;
  normalRange?: number;
  maxRange?: number;
  isOffHand?: boolean;
  damageNote?: string;
}

const calcMod = (score?: number) => score ? Math.floor((score - 10) / 2) : 0;
const getProfBonus = (level?: number) => {
  const l = level || 1;
  return l < 5 ? 2 : l < 9 ? 3 : l < 13 ? 4 : l < 17 ? 5 : 6;
};

/** Compute attack bonus for a weapon hotbar slot + character data */
export function computeAttackInfo(slot: HotbarSlot, char: Character): AttackInfo | null {
  if (slot.type !== 'weapon') return null;
  const equipment = char.equipment || [];
  const slotId = slot.id;
  let item: EquipmentItem | undefined;
  if (slotId.startsWith('attack_main_')) {
    item = equipment.find(e => e.equippedSlot === 'main_hand');
  } else if (slotId.startsWith('attack_off_')) {
    item = equipment.find(e => e.equippedSlot === 'off_hand');
  } else if (slotId.startsWith('throw_main_')) {
    item = equipment.find(e => e.equippedSlot === 'main_hand');
  } else {
    item = equipment.find(e => slotId.includes(e.id));
  }
  if (!item) return null;

  const weapons = (equipmentJson as any).weapons || {};
  const allWeapons = [
    ...(weapons.simple?.melee || []),
    ...(weapons.simple?.ranged || []),
    ...(weapons.martial?.melee || []),
    ...(weapons.martial?.ranged || []),
  ];
  const weaponData = allWeapons.find((w: any) => w.id === item!.id);
  const props: string[] = weaponData?.properties || item.properties || [];

  const hasFinesse = props.some((p: string) => p === 'finesse' || p.includes('灵巧'));
  const isRulesRanged = !!(weapons.simple?.ranged?.some((w: any) => w.id === item!.id)
    || weapons.martial?.ranged?.some((w: any) => w.id === item!.id));
  // For custom weapons: check properties and range object to determine if ranged
  const hasRangedProp = props.some((p: string) => p === 'ammunition' || p === 'range' || p === '弹药' || p === '射程');
  const hasRangeObj = item.range && typeof item.range === 'object' && (item.range as any).normal > 10;
  const isRanged = isRulesRanged || (!isRulesRanged && !weaponData && (hasRangedProp || !!hasRangeObj));
  const isThrown = slotId.startsWith('throw_');

  const strMod = calcMod(char.ability_scores?.strength);
  const dexMod = calcMod(char.ability_scores?.dexterity);
  const profBonus = getProfBonus(char.level);

  let abilityName: string;
  let abilityMod: number;
  if (isRanged && !isThrown) {
    abilityName = '敏捷'; abilityMod = dexMod;
  } else if (hasFinesse) {
    abilityName = dexMod >= strMod ? '敏捷' : '力量';
    abilityMod = Math.max(dexMod, strMod);
  } else {
    abilityName = '力量'; abilityMod = strMod;
  }

  const attackBonus = abilityMod + profBonus;

  let normalRange: number | undefined;
  let maxRange: number | undefined;
  const rangeData = weaponData?.range || item.range;
  if (typeof rangeData === 'object' && rangeData) {
    normalRange = rangeData.normal;
    maxRange = rangeData.long;
  } else if (typeof rangeData === 'string') {
    const m = rangeData.match(/(\d+)\/(\d+)/);
    if (m) { normalRange = parseInt(m[1]); maxRange = parseInt(m[2]); }
  }
  if (!isRanged && !isThrown) {
    normalRange = 5; maxRange = 5;
  }

  // Off-hand damage note
  const isOffHand = slotId.startsWith('attack_off_');
  let damageNote: string | undefined;
  if (isOffHand) {
    const fs = (char as any).fighting_style || (char as any).fightingStyle;
    const fsValue = fs && typeof fs === 'object' ? fs.value : fs;
    const hasTWF = fsValue === 'two_weapon_fighting' || fsValue === 'two_weapon';
    if (hasTWF) {
      const sign = abilityMod >= 0 ? '+' : '';
      damageNote = `${sign}${abilityMod}${abilityName}`;
    } else {
      damageNote = '不含属性调整值';
    }
  }

  return { attackBonus, abilityName, abilityMod, profBonus, isRanged: isRanged || isThrown, normalRange, maxRange, isOffHand, damageNote };
}

interface Props {
  open: boolean;
  slot: HotbarSlot;
  targetName: string;
  distanceFeet?: number;
  attackInfo?: AttackInfo | null;
  character?: Character;
  isDM?: boolean;
  onConfirm: (modifiers?: { powerAttack?: boolean; useLucky?: boolean }) => void;
  onCancel: () => void;
}

const TYPE_ICONS: Record<string, string> = {
  spell: '✦',
  weapon: '⚔',
  equipment: '🛡',
  feature: '★',
  item: '◆',
};

export function HotbarAttackConfirmModal({ open, slot, targetName, distanceFeet, attackInfo, character, isDM, onConfirm, onCancel }: Props) {
  const [powerAttack, setPowerAttack] = useState(false);
  const [useLucky, setUseLucky] = useState(false);

  const canPowerAttack = useMemo(() => {
    if (!character) return false;
    const featIds = (character.feats || []).map((f: any) => typeof f === 'string' ? f : f.value || '');
    const hasGWM = featIds.includes('great_weapon_master');
    const hasSharpshooter = featIds.includes('sharpshooter');
    if (!hasGWM && !hasSharpshooter) return false;
    const props: string[] = slot.meta?.properties as string[] || [];
    const isHeavy = props.some(p => p === 'heavy' || p.includes('重型'));
    const isRanged = attackInfo?.isRanged;
    if (hasGWM && isHeavy && !isRanged) return true;
    if (hasSharpshooter && isRanged) return true;
    return false;
  }, [character, slot, attackInfo]);

  const canUseLucky = useMemo(() => {
    if (!character) return false;
    const featIds = (character.feats || []).map((f: any) => typeof f === 'string' ? f : f.value || '');
    return featIds.includes('lucky');
  }, [character]);

  const icon = slot.icon || TYPE_ICONS[slot.type] || '⚔';
  const avatarUrl = slot.meta?.avatar_url as string | undefined;
  const damage = slot.meta?.damage as string | undefined;
  const damageType = slot.meta?.damageType as string | undefined;

  const ab = attackInfo;
  // Prefer dynamically computed damageNote from attackInfo over static slot.meta
  const damageNote = ab?.damageNote || (slot.meta?.damageNote as string | undefined);

  const dist = distanceFeet !== undefined ? Math.round(distanceFeet) : null;
  const outOfRange = dist !== null && ab?.maxRange && dist > ab.maxRange;
  const hasDisadvantage = dist !== null && ab?.normalRange && ab?.maxRange && dist > ab.normalRange && dist <= ab.maxRange;

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[250]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
          w-[90vw] max-w-sm bg-gray-900 border border-amber-700/60 rounded-xl
          shadow-2xl shadow-amber-900/20 z-[251] p-5">
          {/* Header */}
          <div className="flex items-center gap-3 mb-3">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-10 h-10 object-contain rounded-lg border border-gray-700" />
            ) : (
              <span className="w-10 h-10 flex items-center justify-center text-2xl
                             bg-gray-800 rounded-lg border border-gray-700">
                {icon}
              </span>
            )}
            <div className="flex-1 min-w-0">
              <Dialog.Title className="text-base font-semibold text-amber-200 truncate">
                {slot.name}
              </Dialog.Title>
              {damage && (
                <div className="text-xs text-gray-400 flex gap-3">
                  <span>伤害: <span className="text-gray-200">{damage}</span></span>
                  {damageType && <span>类型: <span className="text-gray-200">{tDamageType(damageType)}</span></span>}
                </div>
              )}
              {damageNote && (
                <div className={`text-[10px] flex items-center gap-1 ${damageNote.includes('不含') ? 'text-gray-500' : 'text-green-400'}`}>
                  [{damageNote}]
                  <span className="cursor-help text-gray-600 hover:text-gray-400"
                    title={damageNote.includes('不含')
                      ? '副手攻击不含属性调整值（需要双武器战斗风格）'
                      : '双武器战斗风格：副手攻击伤害可加属性调整值'}
                  >?</span>
                </div>
              )}
            </div>
          </div>

          {/* Stats */}
          <div className="space-y-1.5 text-xs mb-3 px-1">
            {ab && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">命中加值:</span>
                <span className={`font-medium ${powerAttack ? 'text-amber-400' : 'text-green-400'}`}>
                  {powerAttack
                    ? (ab.attackBonus - 5 >= 0 ? '+' : '') + (ab.attackBonus - 5)
                    : '+' + ab.attackBonus}
                </span>
                <span className="text-gray-600">
                  ({ab.abilityName}{ab.abilityMod >= 0 ? '+' : ''}{ab.abilityMod} + 熟练+{ab.profBonus}{powerAttack ? ' - 强力打击5' : ''})
                </span>
              </div>
            )}
            {damageNote && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">伤害加值:</span>
                <span className={damageNote.includes('不含') ? 'text-amber-300' : 'text-green-300'}>
                  {damageNote.includes('不含')
                    ? '仅武器骰（需「双武器战斗」风格）'
                    : `${damageNote}（双武器战斗）`}
                </span>
              </div>
            )}
            {ab && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">{slot.id?.startsWith('throw_') ? '投掷射程:' : '射程:'}</span>
                <span className="text-gray-300">
                  {ab.normalRange && ab.maxRange && ab.normalRange !== ab.maxRange
                    ? `${ab.normalRange}/${ab.maxRange}尺`
                    : `${ab.normalRange || 5}尺`}
                </span>
              </div>
            )}
            {dist !== null && (
              <div className="flex items-center gap-1.5">
                <span className="text-gray-500">距目标:</span>
                <span className={`font-medium ${
                  outOfRange ? 'text-red-400' : hasDisadvantage ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {dist}尺
                </span>
                {outOfRange && !isDM && <span className="text-red-400 text-[10px]">超出射程，无法攻击</span>}
                {outOfRange && isDM && <span className="text-yellow-400 text-[10px]">超出射程（DM强制）</span>}
                {hasDisadvantage && <span className="text-yellow-400 text-[10px]">远程劣势</span>}
              </div>
            )}
          </div>

          {/* Power Attack toggle (GWM / Sharpshooter) */}
          {canPowerAttack && (
            <div className="px-1 mb-2">
              <button onClick={() => setPowerAttack(!powerAttack)}
                className={`w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
                  ${powerAttack
                    ? 'bg-red-900/40 border-red-500/60 text-red-300'
                    : 'bg-gray-800/60 border-gray-600/40 text-gray-400 hover:border-gray-500'}`}>
                强力打击：命中 <span className={powerAttack ? 'text-red-400' : ''}>-5</span>
                ，伤害 <span className={powerAttack ? 'text-green-400' : ''}>+10</span>
                {powerAttack ? ' ✓' : ''}
              </button>
            </div>
          )}

          {/* Lucky feat toggle */}
          {canUseLucky && (
            <div className="px-1 mb-2">
              <button onClick={() => setUseLucky(!useLucky)}
                className={`w-full px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors
                  ${useLucky
                    ? 'bg-emerald-900/40 border-emerald-500/60 text-emerald-300'
                    : 'bg-gray-800/60 border-gray-600/40 text-gray-400 hover:border-gray-500'}`}>
                🍀 幸运：消耗1幸运点，获得优势
                {useLucky ? ' ✓' : ''}
              </button>
            </div>
          )}

          {/* Confirm prompt */}
          <div className="text-center text-sm text-gray-200 mb-4">
            确认使用 <span className="text-amber-300 font-medium">{slot.name}</span> 攻击{' '}
            <span className="text-red-400 font-medium">{targetName}</span>？
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onCancel}
              className="flex-1 px-4 py-2 rounded-lg border border-gray-600
                       text-gray-300 hover:bg-gray-800 transition-colors text-sm"
            >
              取消
            </button>
            <button
              onClick={() => onConfirm(
                (powerAttack || useLucky)
                  ? { ...(powerAttack && { powerAttack: true }), ...(useLucky && { useLucky: true }) }
                  : undefined
              )}
              disabled={!!(outOfRange && !isDM)}
              className={`flex-1 px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
                outOfRange && !isDM
                  ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  : 'bg-red-700 hover:bg-red-600 text-white'
              }`}
            >
              {outOfRange && !isDM ? '超出射程' : '确认攻击'}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
