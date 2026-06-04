import { useState, useMemo, useEffect, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import type { HotbarSlot, EquipmentItem } from '~/components/character/CharacterDisplay/types/Character';
import type { SpellSlotInfo } from './Hotbar';
import { applyCharacterSpellModifiers } from '~/utils/spellModifiers';
import { UnifiedSpellCastDialog } from '~/components/spell/UnifiedSpellCastDialog';
import type { SpellCastData } from '~/components/spell/SpellCastActions';
import { tDamageType } from '~/utils/i18n/dictionary';
import { spellDataLoader } from '~/services/spellDataLoader';
import type { Spell } from '~/types/spell';
import classesData from '~/data/rules/classes_with_structured_subclass_features.json';
import { FeatureDetailDialog, type FeatureResourceInfo } from '~/components/shared/FeatureDetailDialog';
import { apiFetch } from '~/utils/api-client';
import { publishAppEvent } from '~/events/appEventBus';

const TYPE_COLORS: Record<string, string> = {
  spell: 'border-purple-500/70 shadow-purple-500/20',
  weapon: 'border-amber-500/70 shadow-amber-500/20',
  equipment: 'border-blue-500/70 shadow-blue-500/20',
  feature: 'border-emerald-500/70 shadow-emerald-500/20',
  item: 'border-gray-400/70 shadow-gray-400/20',
};

const TYPE_ICONS: Record<string, string> = {
  spell: '✦',
  weapon: '⚔',
  equipment: '🛡',
  feature: '★',
  item: '◆',
};

function findFeatureDescription(nameOrId: string, slotName: string): string | null {
  for (const cls of (classesData as any).classes || []) {
    for (const f of cls.features || []) {
      if (f.name === slotName || f.nameEn === nameOrId) return f.description;
    }
    for (const sub of cls.subclasses || []) {
      for (const f of sub.level1Features || []) {
        if (f.name === slotName || f.nameEn === nameOrId) return f.description;
      }
    }
  }
  return null;
}

interface ResourceInfo {
  id: string;
  current: number;
  max: number;
  recharge?: string;
  maxFormula?: string;
}

interface HotbarSlotItemProps {
  slot: HotbarSlot | null;
  index: number;
  characterId?: number;
  classResources?: any[];
  spellSlotInfo?: SpellSlotInfo | null;
  abilityScores?: { charisma?: number; wisdom?: number; intelligence?: number };
  characterLevel?: number;
  eldritchInvocations?: string[];
  isActive?: boolean;
  onClear: () => void;
  onClick: () => void;
  onUseResource?: (resourceId: string, amount: number) => Promise<number | null>;
  onStartTargeting?: (resourceId: string, poolCurrent: number, poolMax: number) => void;
  onStartSmiteTargeting?: (resourceId: string, spellSlotLevel: number) => void;
  onConsumeSpellSlot?: (level: number, resourceId: string) => void;
  onCastSpell?: (data: SpellCastData, slotIndex: number) => void;
  concentrationSpellName?: string | null;
  castingSpellName?: string | null;
  classId?: string;
  equipment?: EquipmentItem[];
  onConsumeMaterial?: (materialId: string) => void;
  isDM?: boolean;
  isSilenced?: boolean;
  isIncapacitated?: boolean;
  hasSomaticFreedom?: boolean;
  onEquipmentAvatarGenerated?: (itemId: string, avatarUrl: string) => void;
  /** 锁定的槽位（如固定主手攻击），不允许清除或替换 */
  locked?: boolean;
}

export function HotbarSlotItem({ slot, index, characterId, classResources, spellSlotInfo, abilityScores, characterLevel, eldritchInvocations, isActive, onClear, onClick, onUseResource, onStartTargeting, onStartSmiteTargeting, onConsumeSpellSlot, onCastSpell, concentrationSpellName, castingSpellName, classId, equipment, onConsumeMaterial, isDM, isSilenced, isIncapacitated, hasSomaticFreedom, onEquipmentAvatarGenerated, locked }: HotbarSlotItemProps) {
  const [detailOpen, setDetailOpen] = useState(false);
  const [spellDetail, setSpellDetail] = useState<Spell | null>(null);
  const [featureDesc, setFeatureDesc] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const [selectedCastLevel, setSelectedCastLevel] = useState(0);
  const [genAvatarLoading, setGenAvatarLoading] = useState(false);

  // Match resource from parent-provided classResources
  const resourceInfo = useMemo<ResourceInfo | null>(() => {
    if (!slot || slot.type !== 'feature' || !classResources?.length) return null;
    const matched = classResources.find(
      (r: any) => slot.meta?.resourceId ? r.id === slot.meta.resourceId : (r.name === slot.name || r.nameEn === slot.id)
    );
    if (!matched || matched.maxFormula === 'passive') return null;
    if (matched.maxFormula === 'spell_slots') {
      if (!spellSlotInfo) return null;
      let totalRemaining = 0, totalMax = 0;
      for (let i = 1; i <= 9; i++) {
        totalRemaining += spellSlotInfo.remaining[i] ?? 0;
        totalMax += spellSlotInfo.max[i] ?? 0;
      }
      if (totalMax <= 0) return null;
      return { id: matched.id, current: totalRemaining, max: totalMax, recharge: matched.currentRechargeType, maxFormula: matched.maxFormula };
    }
    return { id: matched.id, current: matched.current, max: matched.max, recharge: matched.currentRechargeType, maxFormula: matched.maxFormula };
  }, [slot, classResources, spellSlotInfo]);

  // Spell slot usage for spell-type slots (non-cantrip, non-invocation-free)
  const spellSlotResource = useMemo<ResourceInfo | null>(() => {
    if (!slot || slot.type !== 'spell' || !spellSlotInfo) return null;
    if (slot.meta?.invocationFree) return null;
    const spellLevel = slot.meta?.level as number | undefined;
    if (!spellLevel || spellLevel <= 0) return null;
    let effectiveLevel = spellLevel;
    let max = spellSlotInfo.max[spellLevel] ?? 0;
    if (max <= 0) {
      for (let i = spellLevel + 1; i <= 9; i++) {
        if ((spellSlotInfo.max[i] ?? 0) > 0) { effectiveLevel = i; max = spellSlotInfo.max[i]; break; }
      }
    }
    if (max <= 0) return null;
    const remaining = spellSlotInfo.remaining[effectiveLevel] ?? max;
    return { id: `spell_slot_${effectiveLevel}`, current: remaining, max };
  }, [slot, spellSlotInfo]);

  const badgeResource = resourceInfo || spellSlotResource;

  // Spell casting metadata
  const spellLevel = (slot?.type === 'spell') ? (slot.meta?.cantrip ? 0 : ((slot.meta?.level as number) || 0)) : 0;
  const isInvocationFree = !!slot?.meta?.invocationFree;
  const isWarlock = classId === 'warlock';

  // Reset cast level when spell detail modal opens
  useEffect(() => {
    if (detailOpen && slot?.type === 'spell') {
      let initLevel = spellLevel;
      if (isWarlock && initLevel > 0 && !isInvocationFree && spellSlotInfo) {
        for (let i = 9; i >= 1; i--) {
          if ((spellSlotInfo.max[i] ?? 0) > 0) { initLevel = i; break; }
        }
      }
      setSelectedCastLevel(initLevel);
    }
  }, [detailOpen]);

  const handleGenEquipAvatar = useCallback(async () => {
    if (!characterId || !slot || slot.type !== 'item') return;
    setGenAvatarLoading(true);
    try {
      const eq = (equipment || []).find(e => e.id === slot.id);
      const resp = await apiFetch(`/api/characters/${characterId}/equipment-avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: slot.id,
          item_name: slot.name,
          item_description: eq?.description || slot.meta?.description || '',
        }),
      });
      if (!resp.ok) {
        alert('头像生成失败');
        return;
      }
      const data = await resp.json();
      if (data.avatar_url) {
        onEquipmentAvatarGenerated?.(slot.id, data.avatar_url);
        setImgError(false);
      }
    } catch {
      alert('头像生成异常');
    } finally {
      setGenAvatarLoading(false);
    }
  }, [characterId, slot, equipment, onEquipmentAvatarGenerated]);

  if (!slot) {
    return (
      <button
        onClick={onClick}
        className="w-14 h-14 rounded-lg border-2 border-dashed border-gray-600/50
                   flex items-center justify-center text-gray-600 hover:border-gray-500
                   hover:text-gray-400 transition-colors bg-gray-900"
        title={`快捷栏 ${index + 1} (空)`}
      >
        <span className="text-xl">+</span>
      </button>
    );
  }

  const colorClass = TYPE_COLORS[slot.type] || TYPE_COLORS.item;
  const icon = slot.icon || TYPE_ICONS[slot.type] || '◆';
  const avatarUrl = slot.meta?.avatar_url as string | undefined;

  const handleInfoClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (slot.type === 'spell') {
      await spellDataLoader.loadSpellData();
      setSpellDetail(spellDataLoader.getSpellById(slot.id) || null);
      setFeatureDesc(null);
    } else if (slot.type === 'feature') {
      setSpellDetail(null);
      const desc = slot.meta?.description as string | undefined
        || findFeatureDescription(slot.id, slot.name);
      setFeatureDesc(desc || null);
    } else {
      setSpellDetail(null);
      setFeatureDesc(null);
    }
    setDetailOpen(true);
  };

  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    onClear();
  };

  const detailSlot = featureDesc && slot.type === 'feature' && !slot.meta?.description
    ? { ...slot, meta: { ...slot.meta, description: featureDesc } }
    : slot;

  const isUsableFeature = slot.type === 'feature' && resourceInfo && (onUseResource || onStartTargeting || onStartSmiteTargeting);

  const handleMainClick = async () => {
    // Block all actions when incapacitated
    if (isIncapacitated) {
      publishAppEvent("showToast", { message: '💫 失能状态下无法使用', type: 'warning' });
      return;
    }
    if (isUsableFeature) {
      const desc = slot.meta?.description as string | undefined
        || findFeatureDescription(slot.id, slot.name);
      setFeatureDesc(desc || null);
      setSpellDetail(null);
      setDetailOpen(true);
      return;
    }
    // Spell → open detail modal with cast button
    if (slot.type === 'spell' && onCastSpell) {
      await spellDataLoader.loadSpellData();
      setSpellDetail(spellDataLoader.getSpellById(slot.id) || null);
      setFeatureDesc(null);
      setDetailOpen(true);
      return;
    }
    // Item → open detail dialog (for avatar generation etc.)
    if (slot.type === 'item') {
      setSpellDetail(null);
      setFeatureDesc(null);
      setDetailOpen(true);
      return;
    }
    onClick();
  };

  // Handle cast button click
  const handleCast = (castData: SpellCastData) => {
    if (!spellDetail || !onCastSpell) return;
    onCastSpell(castData, index);
    setDetailOpen(false);
    setSpellDetail(null);
  };

  return (
    <>
      <button
        className={`w-14 h-14 rounded-lg border-2 ${colorClass} shadow-md
                    flex flex-col items-center justify-center gap-0.5
                    bg-gray-800 hover:bg-gray-700 transition-colors relative group
                    ${isActive ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-gray-900 bg-gray-700 shadow-[0_0_10px_rgba(251,191,36,0.4)]' : ''}
                    ${isIncapacitated ? 'opacity-40 grayscale cursor-not-allowed' : ''}`}
        onClick={handleMainClick}
        onContextMenu={(e) => { e.preventDefault(); if (!locked) onClear(); }}
        title={`${slot.name}${badgeResource ? ` (${badgeResource.current}/${badgeResource.max})` : ''}${locked ? '' : ' (右键移除)'}`}
      >
        {avatarUrl && !imgError ? (
          <img src={avatarUrl} alt="" className="w-8 h-8 object-contain rounded"
            onError={() => setImgError(true)} />
        ) : (
          <span className="text-lg leading-none">{icon}</span>
        )}
        <span className="text-[10px] leading-tight text-gray-300 truncate max-w-[48px]">
          {slot.name}
        </span>
        {slot.type === 'weapon' && slot.meta?.damage && (
          <span className="text-[9px] leading-none text-amber-400/80 font-mono truncate max-w-[48px]">
            {slot.meta.damage as string}
          </span>
        )}
        {badgeResource && (
          <span className={`absolute -bottom-1.5 -right-1.5 px-1 py-0.5 rounded
                           text-[9px] font-medium tabular-nums leading-none
                           ${spellSlotResource ? 'bg-purple-700/90 text-purple-200' : 'bg-amber-700/90 text-amber-200'}`}>
            {badgeResource.current}/{badgeResource.max}
          </span>
        )}
        <span
          className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-blue-600 rounded-full
                     text-[9px] text-white flex items-center justify-center
                     opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer
                     hover:bg-blue-500"
          onClick={handleInfoClick}
        >
          !
        </span>
        {!locked && (
          <span
            className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-red-600 rounded-full
                       text-[9px] text-white flex items-center justify-center
                       opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer
                       hover:bg-red-500"
            onClick={handleClearClick}
          >
            ×
          </span>
        )}
      </button>

      {/* Detail modal - features use shared FeatureDetailDialog */}
      {slot.type === 'feature' ? (
        <FeatureDetailDialog
          open={detailOpen}
          onOpenChange={setDetailOpen}
          feature={{
            name: slot.name,
            nameEn: slot.id,
            level: slot.meta?.level as number | undefined,
            description: detailSlot.meta?.description as string | undefined,
            icon: slot.icon,
          }}
          characterId={characterId}
          resource={resourceInfo ? {
            id: resourceInfo.id,
            current: resourceInfo.current,
            max: resourceInfo.max,
            maxFormula: resourceInfo.maxFormula || '',
            rechargeType: resourceInfo.recharge,
          } as FeatureResourceInfo : null}
          execution={(slot.meta?.execution as Record<string, any> | undefined) || null}
          spellSlotInfo={resourceInfo?.maxFormula === 'spell_slots' ? spellSlotInfo : undefined}
          abilityScores={abilityScores}
          characterLevel={characterLevel}
          onUseResource={onUseResource}
          onStartTargeting={onStartTargeting}
          onStartSmiteTargeting={onStartSmiteTargeting}
          onConsumeSpellSlot={onConsumeSpellSlot}
        />
      ) : slot.type === 'spell' && spellDetail ? (
        <UnifiedSpellCastDialog
          spell={spellDetail}
          onClose={() => { setDetailOpen(false); setSpellDetail(null); }}
          spellTransform={(s) => applyCharacterSpellModifiers(s, {
            eldritchInvocations: eldritchInvocations || [],
            charismaMod: abilityScores?.charisma != null ? Math.floor((abilityScores.charisma - 10) / 2) : 0,
          })}
          spellSlots={spellSlotInfo?.max || []}
          remainingSlots={spellSlotInfo?.remaining || []}
          selectedCastLevel={selectedCastLevel}
          onSelectCastLevel={setSelectedCastLevel}
          concentrationSpellName={concentrationSpellName}
          castingSpellName={castingSpellName}
          isWarlock={isWarlock}
          isInvocationFree={isInvocationFree}
          equipment={equipment}
          onConsumeMaterial={onConsumeMaterial}
          isDM={isDM}
          isSilenced={isSilenced}
          hasSomaticFreedom={hasSomaticFreedom}
          onCast={handleCast}
        />
      ) : (
        <Dialog.Root open={detailOpen} onOpenChange={setDetailOpen}>
          <Dialog.Portal container={typeof document !== 'undefined' ? document.body : undefined}>
            <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[210]" />
            <Dialog.Content
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
              w-[92vw] max-w-xl max-h-[80dvh] bg-gray-900 border border-indigo-700/50 rounded-lg
              flex flex-col z-[211] shadow-2xl overflow-hidden"
            >
              <Dialog.Description className="sr-only">
                {slot.name}的详细说明对话框。
              </Dialog.Description>
              <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-gray-700/60 flex-shrink-0">
                <Dialog.Title className="text-sm font-semibold text-indigo-300">
                  {slot.name}
                </Dialog.Title>
                <Dialog.Close className="w-8 h-8 flex items-center justify-center rounded
                  bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
                  ✕
                </Dialog.Close>
              </div>
              <div className="flex-1 overflow-y-auto p-3">
                <SlotDescription slot={detailSlot} />
              </div>
              {slot.type === 'item' && characterId && onEquipmentAvatarGenerated && (
                <div className="px-4 py-2 border-t border-gray-700/40 flex-shrink-0">
                  <button
                    onClick={handleGenEquipAvatar}
                    disabled={genAvatarLoading}
                    className="w-full py-2 rounded bg-indigo-700/50 hover:bg-indigo-600/50
                      text-indigo-200 text-sm font-medium transition-colors border border-indigo-600/40
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {genAvatarLoading ? '生成中...' : '生成头像'}
                  </button>
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </>
  );
}


function SlotDescription({ slot }: { slot: HotbarSlot }) {
  const meta = slot.meta || {};

  return (
    <div className="space-y-3 text-sm text-gray-300">
      <div className="flex items-center gap-2">
        <span className="text-2xl">{slot.icon || TYPE_ICONS[slot.type]}</span>
        <div className="flex-1">
          <div className="font-medium text-gray-100">{slot.name}</div>
          {meta.cost && (
            <span className="text-xs text-amber-400">消耗：{meta.cost}</span>
          )}
        </div>
      </div>
      {meta.description && (
        <p className="text-gray-400 whitespace-pre-wrap">{meta.description}</p>
      )}
      {meta.damage && (
        <div className="flex gap-4 text-xs">
          <span><span className="text-gray-500">伤害：</span>{meta.damage}</span>
          {meta.damageType && <span><span className="text-gray-500">类型：</span>{tDamageType(String(meta.damageType))}</span>}
        </div>
      )}
      {meta.range && (
        <div className="text-xs">
          <span className="text-gray-500">{slot.id?.startsWith('throw_') ? '投掷射程：' : '射程：'}</span>{meta.range}
        </div>
      )}
    </div>
  );
}
