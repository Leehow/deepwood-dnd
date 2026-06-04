import { useMemo } from 'react';
import { SpellDetailModal } from '~/components/spell/SpellSelectableCard';
import { normalizeSpellData } from '~/components/spell/normalizeSpell';
import { SpellCastActions } from '~/components/spell/SpellCastActions';
import type { SpellCastData } from '~/components/spell/SpellCastActions';

interface UnifiedSpellCastDialogProps {
  spell: any | null;
  onClose: () => void;
  spellSlots: number[];
  remainingSlots: number[];
  selectedCastLevel: number;
  onSelectCastLevel: (level: number) => void;
  concentrationSpellName?: string | null;
  castingSpellName?: string | null;
  isWarlock?: boolean;
  isInvocationFree?: boolean;
  equipment?: any[];
  onConsumeMaterial?: (materialId: string) => void;
  isDM?: boolean;
  isSilenced?: boolean;
  hasSomaticFreedom?: boolean;
  campaignId?: string;
  spellTransform?: (normalized: any) => any;
  onCast: (data: SpellCastData) => void;
}

export function UnifiedSpellCastDialog({
  spell,
  onClose,
  spellSlots,
  remainingSlots,
  selectedCastLevel,
  onSelectCastLevel,
  concentrationSpellName,
  castingSpellName,
  isWarlock,
  isInvocationFree,
  equipment,
  onConsumeMaterial,
  isDM,
  isSilenced,
  hasSomaticFreedom,
  campaignId,
  spellTransform,
  onCast,
}: UnifiedSpellCastDialogProps) {
  const normalizedSpell = useMemo(() => (spell ? normalizeSpellData(spell) : null), [spell]);
  const finalSpell = useMemo(
    () => (normalizedSpell && spellTransform ? spellTransform(normalizedSpell) : normalizedSpell),
    [normalizedSpell, spellTransform],
  );

  return (
    <SpellDetailModal
      spell={finalSpell}
      onClose={onClose}
      spellTransform={undefined}
      actions={finalSpell ? (
        <SpellCastActions
          spell={finalSpell}
          selectedCastLevel={selectedCastLevel}
          onSelectCastLevel={onSelectCastLevel}
          spellSlots={spellSlots}
          remainingSlots={remainingSlots}
          concentrationSpellName={concentrationSpellName}
          castingSpellName={castingSpellName}
          isWarlock={isWarlock}
          isInvocationFree={isInvocationFree}
          damageAtSlotLevel={finalSpell.damageAtSlotLevel}
          healingAtSlotLevel={finalSpell.healingAtSlotLevel}
          damageTypeCn={finalSpell.damageTypeCn}
          equipment={equipment}
          onConsumeMaterial={onConsumeMaterial}
          isDM={isDM}
          isSilenced={isSilenced}
          hasSomaticFreedom={hasSomaticFreedom}
          campaignId={campaignId}
          onCast={onCast}
        />
      ) : null}
    />
  );
}
