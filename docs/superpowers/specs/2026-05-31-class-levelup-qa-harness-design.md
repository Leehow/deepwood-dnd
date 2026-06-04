# Class / Level-Up QA Harness — Design Spec

**Date**: 2026-05-31
**Status**: Approved design, pending implementation plan
**Owner**: leeehow@gmail.com
**Tracking branch**: `feat/class-qa-harness`
**Sibling**: [2026-05-30-spell-runtime-browser-qa-harness-design.md](2026-05-30-spell-runtime-browser-qa-harness-design.md) (same QA philosophy, different surface)

## Purpose

Find bugs across **every class's every option and every level-up choice**. The
target surface is `level_up_character()` at
[backend/app/api/routes/characters.py:2920](../../../backend/app/api/routes/characters.py)
(~500 lines applying every choice type) plus the derived-stat services it feeds —
a surface that today has **one** test (asserts `level == 2`).

Unlike the spell harness (dice + canvas → agent-driven browser), a data-driven
level-up sweep is **fully deterministic** (HP uses average rolls, not RNG — see
[character_progression_service.py:126](../../../backend/app/services/character_progression_service.py)),
so the backbone is a parametrized **pytest** suite that can live in CI as a
permanent regression gate. A thin, separately-maintained browser smoke layer +
human-readable report layer ride on top.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Test layer | API/state-level sweep as backbone + thin browser smoke |
| Coverage scope | Single-class full coverage (12 classes × all subclasses, L1→20, every option ≥1×) + a small representative multiclass set |
| Oracle | Layered: **smoke** + **computed-invariant** (independent SRD tables) + **differential** (incremental walk vs build-at-level) |
| Deliverable | **Both**, maintained separately: a deterministic pytest regression gate + a script/report layer (human report + browser smoke) |
| Path enumeration | **Data-driven generator** reads `classes-progression.json` + option data → pytest params. Not hand-written. |

## Non-goals

- Not a D&D rules rewrite. Ambiguous rules → status `NEEDS_RULES_DECISION`.
- Not full multiclass combinatorics (millions of paths). Multiclass is a curated
  representative set targeting known bug surfaces (§5).
- Not a per-feature hand-authored expectation table. The oracle derives expected
  values from independent reference tables + differential cross-checks; per-feature
  fixtures are reserved for individually-tricky features as a later add-on.
- Not a production data migration. Test data lives in the `*_test` DB and is torn
  down per path.

## The target surface (verified 2026-05-31)

- **12 classes**, **12 `subclass` selection nodes** (~40 subclass options total),
  **14 `choice` nodes**, **143 `feature` nodes** in
  [frontend/app/data/rules/classes-progression.json](../../../frontend/app/data/rules/classes-progression.json)
  (`{version, classes:{fighter, wizard, ...}}`).
- Choice node shape (options **inline**):
  `{id, name, nameEn, type:"choice", required, description, choices:[{id, name, nameEn, description}]}`.
- Subclass node shape: same, but each option carries nested
  `features:[{id, level, name, description}]` — and those features can contain
  **further** choice points (Battle Master maneuvers, Champion's level-10 second
  fighting style, sorcerer metamagic, …). The generator recurses into them.
- External option lists: warlock invocations →
  [eldritch_invocations.json](../../../frontend/app/data/rules/eldritch_invocations.json);
  feats → [feats.json](../../../frontend/app/data/rules/feats.json); subclass
  features → [classes_with_structured_subclass_features.json](../../../frontend/app/data/rules/classes_with_structured_subclass_features.json).
- **ASI/feat** is a `feature` node (not a `choice`), applied via the level-up
  endpoint's `ability_scores_increase` / feat path. The generator special-cases
  ASI levels (4/8/12/16/19 + fighter 6/14, rogue 10) and tests both branches:
  "+2 to one ability" and "take a feat".
- **Build-at-level exists deterministically**: `CharacterCreate` accepts
  `level: int = 1` **plus** all choice fields (fighting_style, eldritch_invocations,
  maneuvers_known, expertise_skills, selected_spells, subclass_id, subclass_choices…)
  at [character_sheet.py:59](../../../backend/app/schemas/character_sheet.py). This
  is the "direct build" side of the differential oracle, and it runs through
  *different* code than the incremental level-up chain.

## Architecture

```
backend/tests/qa_classes/
  generator.py        # progression + option data → (class, subclass, level, choice, option) params
  reference_tables.py # INDEPENDENT hand-authored SRD tables (slots / HP / proficiency / resource caps)
  oracles.py          # three assertion layers: smoke / invariant / differential
  drivers.py          # reuse conftest client+auth_headers: build_at_level / walk_1_to_20 / level_up_once
  test_progression_walk.py   # one 1→20 walk per (class, subclass)
  test_option_probes.py      # one isolated probe per selectable option
  test_multiclass.py         # ~8 representative combos (§5)
  classifier.py       # failure → owner surface (data / level-up code / derivation / frontend / rules)
scripts/class-qa/
  run_report.py       # run pytest (json report) → summary.md grouped by owner
  browser_smoke.md    # thin browser layer: level-up wizard checklist for ~3-4 representative classes
artifacts/class-qa/<date>/   # results.json · summary.md · browser screenshots
```

The pytest layer reuses the existing [conftest.py](../../../backend/tests/conftest.py)
fixtures (`client: AsyncClient`, `auth_headers`, function-scoped `*_test` engine,
`create_access_token`). New files are kept under the ~400-line repo guideline by
the split above.

**Data loading respects the repo rule**: `generator.py` loads progression / option
JSON through `rules_cache` loaders (add a loader where one is missing), never via
hardcoded `Path(__file__)` joins. `reference_tables.py` is the one exception by
design — it hardcodes SRD reference values *as constants*, reading no app data file
(see §1 independence rule).

## §1 The three oracle layers (core)

| Layer | Catches | How it asserts |
|---|---|---|
| **Smoke** | crashes, silently-dropped choices | level-up returns 2xx (no 500); the chosen option lands in the correct character field (`fighting_style` / `eldritch_invocations` / `subclass_id` / `maneuvers_known` / `expertise_skills` / `feats` …) |
| **Computed-invariant** | numeric bugs in **code *and* data** | at every level, derive from **independently hand-authored SRD reference tables** and assert: max HP, spell-slot vector, proficiency bonus, resource caps (rages / ki / bardic inspiration / sorcery points / channel divinity …), passive numbers (crit range, attacks-per-action). |
| **Differential** | order-dependent / state-clobber / level_history bugs | incremental L1→20 (through `level_up_character`) vs direct `CharacterCreate(level=20, all options)` (through the all-at-once chain) → compare final derived state. The two paths share almost no application code, so divergence is a real bug. |

**Independence rule (load-bearing)**: `reference_tables.py` must NOT read
`classes.json` / `spellcasting.json` / `passive_features.json`. It encodes the
PHB/SRD numbers as constants (full-caster slot table, proficiency bonus by total
level, hit-die-by-class, per-class resource progressions). If the oracle read the
same data the code reads, a wrong *data* value would self-agree with the code and
pass silently. Independent tables are what let this harness catch **data** bugs,
not just code bugs.

Many invariants are class-independent and cheap to encode authoritatively:
- Proficiency bonus = `2 + (total_level - 1) // 4`.
- Full-caster slot vector is fixed by caster level regardless of class.
- Half-caster (paladin/ranger) and warlock-pact tables are short and fixed.

## §2 Path generation

1. `generator.py` walks `classes[id]`, collecting every `choice` and `subclass`
   node with its level; recurses into each subclass option's `features[]` to find
   nested choice points; resolves external id lists (invocations / feats /
   maneuvers / metamagic) from their source files.
2. **Walk policy (deterministic "canonical choice")**: each 1→20 progression walk
   picks the **first legal option** at every choice point. This guarantees a
   reproducible path. Walks are *not* used to brute-force option coverage.
3. **Option coverage is carried by probes, not walks**: for each enumerable
   option X at prerequisite level L, build a character directly at level **L-1**
   with the prerequisites via `CharacterCreate`, then `level-up` once choosing
   **only** X, and assert it lands (smoke) without 500. One option = one named,
   isolated test → a failure points at exactly one option, not a whole progression.
4. ASI/feat levels generate two probes each (ability-increase vs feat).

## §3 Drivers & test isolation

- `drivers.py` exposes `build_at_level(class_id, subclass_id, level, choices)`,
  `walk_1_to_20(class_id, subclass_id, choice_script)`, and
  `level_up_once(character_id, class_choice, feature_choices)` — all over the
  conftest `client` + `auth_headers`.
- Reuse the function-scoped `*_test` DB + `create_all`. Each path uses a character
  owned by a per-test user.
- **Explicit teardown**: characters are user-owned and do **not** cascade with
  campaign deletion (a known spell-harness gotcha) — delete created characters
  explicitly after each path.
- **No campaign needed** for most paths (characters exist standalone). Only the
  few multiclass paths exercising companion-token / broadcast side effects attach
  a campaign.

## §4 Multiclass representative set (~8 combos)

Each combo targets a known bug surface; not exhaustive combinatorics.

| Combo | Targets |
|---|---|
| wizard / cleric | full+full caster-level slot stacking |
| wizard / paladin | full+half slot stacking |
| sorcerer / warlock | pact slots kept separate from caster slots |
| paladin / warlock | half-caster slots + pact slots coexisting |
| barbarian / fighter | no casting; resource separation (rage vs action surge) |
| cleric / druid | two prepared full-casters; prep recompute |
| rogue / fighter | proficiency bonus by **total** level; sneak attack scaling |
| fighter / wizard | per-class resource caps + the first-level-die HP seed bug (§6) |

## §5 Result & report schema

Statuses: `PASS · FAIL · BLOCKED_BY_TEST_INFRA · BLOCKED_BY_APP_BUG ·
NEEDS_RULES_DECISION · DEFERRED`.

`classifier.py` assigns each failure an **owner surface**:
- **class data** — `classes-progression.json` / option JSON (missing/duplicate
  options, wrong level gating, dangling resource ids)
- **level-up code** — `characters.py` level-up chain + `character_progression_service`
- **derivation** — `passive_feature_service` / `class_resource_service` / `get_initial_spell_slots`
- **frontend wizard** — only surfaceable via the browser smoke layer
- **rules decision** — ambiguous; needs a human ruling

`scripts/class-qa/run_report.py` runs pytest with a JSON report and emits
`artifacts/class-qa/<date>/summary.md` aggregated by owner. (Per the spell-harness
precedent, the evidence catalog lives under `artifacts/`, not `debug/test/`, which
covers ad-hoc throwaway output.)

## §6 Candidate bugs to seed assertions

These are real findings from this design pass; encode them as named assertions in
Phase 1/3 so the harness proves it can catch them:

- **Multiclass first-level hit die**:
  [calculate_max_hp:124](../../../backend/app/services/character_progression_service.py)
  grants the **full** hit die for the first level of **every** class entry. In 5e
  only the character's **very first** level gets the max die; a multiclassed class's
  first level should be the **average**. The differential + invariant layers should
  flag this. (May resolve as `NEEDS_RULES_DECISION` if intentional.)
- **Level-up performs no choice validation**: the endpoint trusts `feature_choices`
  (the frontend gates them). Probes should submit illegal choices (a duplicate
  fighting style, an over-level option, a maneuver on a non–Battle Master) and
  record whether the backend silently accepts them.

## §7 Browser smoke layer (thin)

Drive the real level-up wizard UI for ~3-4 representative classes only — e.g. a
prepared-caster (cleric), a known-option class (fighter / Battle Master), a warlock
(invocations) — verifying the wizard **presents the correct options, validates
them, and submits successfully**. This catches frontend selection/validation bugs
that the API layer can't see. Everything else is covered by the pytest layers. The
browser layer is maintained separately from the pytest gate.

## §8 Execution phases

| Phase | Content | Exit criteria |
|---|---|---|
| 0 | Build `generator` + `reference_tables` + `drivers`; 3-class self-test (short walk for fighter / wizard / warlock) + same-input-twice determinism check | Self-test green |
| 1 | Smoke breadth: all walks + all option-probes assert only "no 500 + option landed"; wire the §6 seed assertions | Every path has a result row |
| 2 | Wire the computed-invariant layer (per-level HP / slots / proficiency / resource caps / passives) | Invariant assertions connected for all single-class paths |
| 3 | Wire the differential layer (incremental walk vs direct build-at-level) | Differential green or divergence recorded for all single-class paths |
| 4 | Multiclass representative set (§4) + browser smoke (§7) | 8 combos have result rows; representative wizards verified |
| 5 | Produce first owner-classified bug report; fix + regress | Report emitted; regression green; pytest gate added to CI |

## §9 Pass criteria

- Every `(class, subclass)` in the progression data has a walk result row; every
  enumerable option has a probe result row.
- All three oracle layers connected; every `FAIL` has a reproducible case + an
  owner surface.
- The pytest gate is deterministic and added to CI; the browser smoke + report
  layer are maintained separately (the locked "both, separately" decision).
- The multiclass representative set has a result row per combo.
- The two §6 seed bugs are either fixed or explicitly recorded as
  `NEEDS_RULES_DECISION` with a rationale.

## §10 Open questions for implementation

These do not block the plan but need a decision during the noted phase:

1. **Per-choice option resolution** (Phase 0): confirm, per choice type, whether
   options are inline in the progression node or must be resolved from an external
   file (invocations / feats / maneuvers / metamagic), and centralize that mapping
   in `generator.py`.
2. **Differential reference fidelity** (Phase 3): confirm `CharacterCreate(level=N)`
   faithfully applies *all* mid-level accumulated choices. If some choice type is
   only applicable via level-up, fall back to a level_history rollback-replay
   differential for that type and record the gap.
3. **Prepared-spell recompute** (Phase 2): level-up sets `can_prepare_spells = True`
   — decide whether the invariant layer asserts prepared-spell *capacity* or only
   that the recompute path doesn't crash.
4. **ASI special-case completeness** (Phase 0): verify the exact ASI/feat levels
   per class (fighter and rogue have extra ASIs) directly from the progression data
   rather than hardcoding the standard 4/8/12/16/19 list.
