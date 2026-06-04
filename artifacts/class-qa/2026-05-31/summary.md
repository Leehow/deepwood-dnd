# Class / Level-Up QA Harness — Run Summary

**Date:** 2026-05-31  **Branch:** `feat/class-qa-harness`  **Suite:** `backend/tests/qa_classes/`
**Result:** **137 passed, 0 xfailed** — every finding the harness caught is now fixed.
**Re-run:** `cd backend && source venv/bin/activate && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/ -p no:cacheprovider`
(CI runs the DB-free subset — reference_tables / generator / oracles — on every PR via `.github/workflows/quality-gate.yml`.)

## Coverage (the original ask: "all classes' all options + all level-up options")

| Dimension | Coverage |
|---|---|
| Progression walks | All **40** (class, subclass) pairs walked **1→20**, no 500, level/subclass asserted |
| Inline choice options | fighter/paladin/ranger fighting styles, ranger favored enemy (13), natural explorer (7) — land in the right field |
| External-list options | warlock eldritch invocations, Battle Master maneuvers — land in `eldritch_invocations` / `maneuvers_known` |
| Nested options | warlock pact boon → `subclass_choices.pactBoon`; sorcerer metamagic → `subclass_choices.metamagic` |
| ASI vs feat | ASI +2 applies and caps at 20; feat lands in `feats` |
| Computed invariants (per level) | sheet `hit_points_max` vs independent SRD tables (all 40 @ L20); full-caster slot vectors vs PHB p.201 (5 classes); resource caps via `/resources` |
| Differential | incremental 1→20 vs direct build-at-20 converge (fighter/champion, wizard/evocation, cleric/life, rogue/thief) |
| Multiclass | second-class entry, full+full slot stacking, multiclass HP (5e RAW) |

## Findings (by owner) — all fixed

| # | Finding | Owner | Fix |
|---|---|---|---|
| 1 | Multiclass first-level HP gave the max die to **every** class's first level (5e: only the very first character level) | `character_progression_service.calculate_max_hp` | `96fcba29` |
| 4 | Level-up ASI path had **no +20 cap** (the feat path did) | `characters.py` level-up ASI branch | `96fcba29` |
| 3 | Sorcerer **metamagic** had no backend storage — selections silently dropped | `characters.py` level-up | `7411ef6a` (→ `subclass_choices.metamagic`) |
| 5 | Sheet/HP-routes `_compute_max_hp` was single-class only (disagreed with `calculate_max_hp` for multiclass) | `character_sheet_service._compute_max_hp` | `3060f3c8` (delegates to `calculate_max_hp` + subrace/feat) |
| 2 | Level-up applied a `fighting_style` even at a level the class doesn't grant one | `characters.py` level-up | `e6bb136b` (gated by `_fighting_style_offered_at`; not-offered → ignored, not 422) |

### Notes on the #2 fix
- Offering is read from the progression data: a top-level `type:"choice"` fighting_style node (fighter L1, paladin/ranger L2) OR a selected-subclass feature whose id contains `fighting_style` (Champion's L10 `additional_fighting_style`). Keyed on the leveled class's *class level* so multiclass stays correct.
- **Ignore (no-op), not reject (422)** — the frontend gates choices, so a not-offered submission shouldn't fail the wizard. A 422 variant would be a separate product decision.
- Scope: the fix targets **fighting_style** (the pinned case). Generalizing "not-offered" gating to every choice type is a larger follow-up; the list-valued choices (invocations, maneuvers, metamagic) already de-duplicate.

## Secondary findings noted (other domains — not addressed here)
- `spell_save_dc` is hardcoded to the WIS modifier regardless of class (`characters.py:4608`) — belongs to the **spell** QA harness (it has a cast driver).
- Sheet `armor_class` is a stub (`10 + DEX`, ignores equipped armor) — equipment domain.

## Notes
- The two HP functions were unified under fix #5; HP is now correct (incl. multiclass) across the sheet and the 4 HP-management routes.
- A pre-existing stale-test-factory issue in `tests/test_characters_api.py` (8 failures) was fixed separately (now 9 passed).
