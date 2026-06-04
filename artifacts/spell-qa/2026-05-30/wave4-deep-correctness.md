# Wave-4 Deep-Correctness QA — Results & Fixes (2026-05-30)

Four read-only agents deep-tested rules-correctness (not just HTTP 200) for the
~228 spells only smoke-covered in wave-3, across the full id-sorted catalog
(slices 0–90, 91–181, 182–272, 273–363), against the real working-tree code.

## Coverage
~228 spells deep-tested. **PASS rate very high** — the engine faithfully executes
spell data (resistance halving, save-gating, condition-immunity, concentration,
creature-type exclusion, heal caps all verified correct across the catalog).

## Fixed + verified (committed)

1. **Save-success negated only some effect types** (`spell_resolver.py`): on a
   successful save with `on_success:"no_effect"`, the gate skipped only
   deal_damage/apply_condition/apply_effect — so **polymorph / true_polymorph /
   seeming still transformed/disguised on a successful save**. Now negates the
   ENTIRE phase regardless of effect type. Verified via token `transformation_data`
   (save success → not transformed; save fail → transformed).
2. **`targetCreatureTypes` positive gating not implemented** (`spell_resolver.py`):
   the engine read `excludeCreatureTypes` (negative) but never `targetCreatureTypes`
   (positive), so beast/plant-only spells (animal_friendship, animal_messenger,
   awaken, …) applied to any target. Added symmetric positive gating. Verified
   (animal_friendship on a humanoid → `excluded`).
3. **reset didn't clear the forced-roll queue** (`qa.py`): a stale forced roll
   contaminated the next cast's attack/save. reset now clears the queue (test
   isolation). This was corrupting deterministic assertions.

## Open findings (documented for follow-up; spawned where high-value)

### Data — spell JSON (per-spell, need careful edits)
- **5 spells drop their structured effect** because it sits on a `trigger:"narrative"`
  phase (rendered RP-only): `magic_mouth`, `major_image`, `mirage_arcane`,
  `nystuls_magic_aura` (each `spawn_illusion`), `mordenkainens_private_sanctum`
  (`create_zone_visual`). Fix: flip those phases to `trigger:"on_cast"` (the
  working `programmed_illusion` uses on_cast). Severity: cosmetic/runtime-visual
  (no combat math). Also `transport_via_plants`/`word_of_recall` teleports are on
  narrative-trigger (deferred-by-design there).
- **speak_with_plants** applies a spurious `restrained` condition (its phase0 has
  an `apply_condition:restrained`); RAW it frees creatures from restraint, never
  imposes it. Fix: remove that apply_condition.
- **conjure_barrage**: top-level `damageType:"piercing"` disagrees with the effect's
  `damage_type:"slashing"` (both RAW-legal "choose one"). Data tidiness.

### Engine (moderate)
- **power_word_stun** has TWO defects: (a) no HP≤150 gate (a 200-HP target gets
  stunned), and (b) a spurious initial CON save in its data lets targets escape
  (RAW: auto-stun, save only ENDS it). NOTE: removing the save alone (without the
  HP gate) makes it strictly worse (auto-stuns everything), so these must be fixed
  together. `power_word_kill` DOES gate at 100 HP, so the HP-threshold mechanism
  exists and should be generalized to power_word_stun.
- **`save_override` dict ignored** (`spell_cast.py:~1017/1046`): monster
  `saving_throws` arrive as a dict but are only forwarded `if isinstance(int)`, so
  **monster proficient-save bonuses are always discarded** on the /api/spells/cast
  path. (Didn't affect QA monsters — none seed saving_throws.)
- **scrying** `grant_sense` lives in a separate on_cast phase with no save block, so
  a successful WIS save doesn't stop the sensor (data-structure split).

### Follow-up investigation notes (2026-05-30)
- **monster-instances 500: VERIFIED RESOLVED on current code** — seed + 3 immediate
  GETs all return 200. `_commit_normalized_monsters` refreshes `updated_at`, and the
  QA seed now pre-populates `monster_data` so no normalization UPDATE/commit-expiry
  occurs. Agents hit it on an earlier revision.
- **narrative-trigger batch is NOT a safe blind flip**: a full-catalog scan finds 17
  spells with structured effects on a narrative phase, but many are *intentionally*
  deferred — flipping them to on_cast would break them: goodberry (heal on eat),
  word_of_recall / transport_via_plants (delayed teleport), heroes_feast (1-hour
  ritual), glyph_of_warding (triggers later). Only the persistent illusion/zone-visual
  ones (minor_illusion, darkness, detect_evil_and_good, hallucinatory_terrain,
  creation + major_image/mirage_arcane/nystuls_magic_aura/magic_mouth/
  mordenkainens_private_sanctum) are flip candidates, and even those depend on whether
  the frontend consumes spawn_illusion/create_zone_visual markers. Needs per-spell
  judgment — left to the spawned data task, not auto-fixed.

### By-design / out of scope
- **divine_word** applies all three conditions flat; RAW uses HP-tiered outcomes
  not encoded in spells.json (narrative-only). Data-modeling simplification,
  consistent with power_word_* — not an engine bug.
- **`GET /api/monster-instances/campaign/{id}` 500s** (`monster_instances.py:193`):
  `ResponseValidationError`/`MissingGreenlet` on `updated_at` (async lazy-load
  outside greenlet) right after a seed commit. Flagged by 3 agents across waves.
  NOT spell-related but a real recurring 500 on a common endpoint — spawned.

## Cumulative (4 waves)
Full 364-spell catalog: smoke-tested for crashes (all cast 200 after fixes) +
~228 deep-tested for rules-correctness this wave (+~136 in waves 1–2). Engine-level
correctness bugs found & fixed: resistance/immunity application, Bane direction,
undead/construct heal exclusion, reset contamination (conditions + concentration +
dice queue), heal over-full/caster clamp, save-success effect-type negation,
targetCreatureTypes positive gating, plus data 500s (camelCase, turn_undead).
Remaining items are per-spell data corrections + 2 moderate engine gaps + 1
recurring non-spell route 500 — all documented above.
