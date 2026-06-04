/**
 * Conditions a spell's visual buff should display = the conditions it actually
 * APPLIES via `apply_condition` effect entries. The top-level `conditions` field
 * is a loose "related conditions" tag — it also lists conditions the spell
 * removes / prevents / detects, or that belong to an invisible object/sensor
 * rather than the buffed creature — and copying it onto a token buff mis-renders
 * the token (BUG B: it dims faerie_fire/restoration targets and shows bogus
 * condition badges). Mirrors backend `app/utils/spell_buff_conditions.py`.
 */
type SpellEffectEntry = { type?: string; condition?: string };
type SpellEffectPhase = { effects?: SpellEffectEntry[] | null };

export function deriveBuffConditions(
  spell: { effects?: SpellEffectPhase[] | null } | null | undefined,
): string[] {
  const derived: string[] = [];
  for (const phase of spell?.effects ?? []) {
    for (const eff of phase?.effects ?? []) {
      if (eff?.type !== 'apply_condition') continue;
      const cond = eff?.condition;
      if (cond && !derived.includes(cond)) derived.push(cond);
    }
  }
  return derived;
}
