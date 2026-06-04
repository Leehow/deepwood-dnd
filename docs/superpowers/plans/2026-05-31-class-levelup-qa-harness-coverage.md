# Class / Level-Up QA Harness — Plan C (Option-Coverage Extension) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Complete the "all options" coverage by probing the choice types Plan A/B deferred — warlock pact boon (nested), sorcerer metamagic, warlock eldritch invocations, Battle Master maneuvers, and ASI-vs-feat — each asserting "no 500 + the choice lands (or surfacing that it doesn't)."

**Architecture:** Extends `backend/tests/qa_classes/` (Plan A+B green: 122 passed / 2 xfailed). Adds nested-field support to `oracles.option_landed`, extends `generator.CHOICE_FIELD_MAP` + adds external-list option sources, and adds targeted probe tests. The report/browser/CI layers are **Plan D** (deferred — this cycle is purely about closing the option-coverage gap, the heart of the original ask).

**Tech Stack:** Same as A/B. Dev run: `cd backend && source venv/bin/activate && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/<file> -v -p no:cacheprovider` (no `--no-cov`).

## Verified facts (grounded 2026-05-31)

Level-up `feature_choices` key → Character field (from the grounding report):
| Choice | fc key | field | nesting | option source |
|---|---|---|---|---|
| pact_boon | `pact_boon` | `subclass_choices["pactBoon"]` | **nested** | inline in progression (warlock L3, 3 opts: chain/blade/tome) |
| metamagic | `metamagic` | **(none — not handled!)** | — | inline in progression (sorcerer L3, 8 opts) |
| eldritch_invocations | `eldritch_invocations` | `eldritch_invocations` (top) | top, list | external `eldritch_invocations.json` |
| maneuvers | `maneuvers` | `maneuvers_known` (top) | top, list | inline in Battle Master subclass features / data |
| ASI | `asiOrFeat:"asi"` + `asiChoices` | `ability_scores` | top | n/a (ability ids) |
| feat | `asiOrFeat:"feat"` + `featId` | `feats` (append) | top, list | external `feats.json` |

- **metamagic is NOT handled by level-up** (no branch, no field, no column) — a metamagic probe will surface this as a real finding (the choice silently vanishes).
- `pact_boon` lands nested under `subclass_choices["pactBoon"]` → `option_landed` needs nested-path support.
- Invocation/feat option ids come from their JSON files (add `rules_cache` loaders if missing — `get_eldritch_invocations_data`, `get_feats_data` already exist per Plan A grounding).

---

### Task 1: Nested-field support + pact_boon / metamagic probes

**Files:**
- Modify: `backend/tests/qa_classes/oracles.py` (nested path in `option_landed`)
- Modify: `backend/tests/qa_classes/generator.py` (map pact_boon nested; add metamagic with a "expected-unsupported" marker)
- Test: `backend/tests/qa_classes/test_oracles_smoke.py` (nested case), `backend/tests/qa_classes/test_nested_and_unsupported.py`

- [ ] **Step 1: Failing test for nested `option_landed`** — append to `test_oracles_smoke.py`:
```python
def test_option_landed_nested_path():
    char = {"subclass_choices": {"pactBoon": "pact_of_the_blade"}}
    assert oracles.option_landed(char, "subclass_choices.pactBoon", "pact_of_the_blade")
    assert not oracles.option_landed(char, "subclass_choices.pactBoon", "pact_of_the_tome")
    assert not oracles.option_landed({}, "subclass_choices.pactBoon", "x")
```

- [ ] **Step 2: Run → fail** (current `option_landed` does `character_json.get(field)` with the literal dotted key).

- [ ] **Step 3: Add dotted-path resolution to `option_landed` in `oracles.py`**:
```python
def _resolve_path(obj: dict, path: str):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def option_landed(character_json: dict, field: str, option_id: str) -> bool:
    return option_id in _ids_in(_resolve_path(character_json, field))
```
(`_ids_in` unchanged; the only change is `.get(field)` → `_resolve_path(...)`, which is backward-compatible for non-dotted keys.) Run → pass.

- [ ] **Step 4: Probe pact_boon (nested) and metamagic (expected-unsupported)** — `test_nested_and_unsupported.py`:
```python
"""pact_boon should land (nested); metamagic is currently unsupported by level-up —
this test DOCUMENTS that gap (xfail strict) so it flips to error when support lands."""
import pytest
from tests.qa_classes import drivers, oracles

pytestmark = [pytest.mark.asyncio]


async def test_warlock_pact_boon_lands_nested(qa_client, qa_headers, qa_user_id):
    # warlock picks subclass at L1, pact boon at L3. Build L2 warlock w/ subclass, then L3 pact.
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "warlock",
                                           level=2, subclass_id="fiend")
    oracles.assert_status_ok(created, "create warlock L2 fiend")
    lv3 = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "warlock",
                                      {"pact_boon": "pact_of_the_blade"})
    oracles.assert_status_ok(lv3, "warlock L3 pact_boon")
    oracles.assert_option_landed(lv3.json(), "subclass_choices.pactBoon",
                                 "pact_of_the_blade", "warlock pact_of_the_blade")


@pytest.mark.xfail(reason="metamagic is not handled by the level-up endpoint (no field, "
                          "no branch) — the choice is silently dropped", strict=True)
async def test_sorcerer_metamagic_lands(qa_client, qa_headers, qa_user_id):
    # sorcerer picks subclass at L1, metamagic at L3.
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "sorcerer",
                                           level=2, subclass_id="draconic_bloodline")
    oracles.assert_status_ok(created, "create sorcerer L2")
    lv3 = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "sorcerer",
                                      {"metamagic": ["quickened_spell", "twinned_spell"]})
    oracles.assert_status_ok(lv3, "sorcerer L3 metamagic")
    # there is no metamagic field; assert it landed somewhere (it won't → xfail)
    body = lv3.json()
    landed = oracles.option_landed(body, "metamagic", "quickened_spell") or \
        oracles.option_landed(body, "subclass_choices.metamagic", "quickened_spell")
    assert landed, "metamagic choice did not land anywhere on the character"
```
Confirm the real subclass ids (`fiend`, `draconic_bloodline`) via `iter_class_subclass_pairs()`; adjust if the data differs. TRIAGE: pact_boon landing → if it FAILS, that's a real finding (the nested write didn't happen). metamagic → expect xfail (documents the gap); if pact_boon's create-at-L2-with-subclass path errors, recall `CharacterSubclassChoices` can't carry pactBoon at create — but here pact_boon is set via the L3 **level-up**, which CAN write nested, so it should work.

- [ ] **Step 5: Commit** `test(class-qa): nested option_landed + pact_boon/metamagic probes`

---

### Task 2: External-list option coverage (invocations + maneuvers)

**Files:**
- Modify: `backend/tests/qa_classes/generator.py` (add `iter_external_option_probes()` reading invocation/maneuver ids)
- Test: `backend/tests/qa_classes/test_external_options.py`

- [ ] **Step 1: Failing generator test** — assert `generator.iter_external_option_probes()` yields warlock invocation probes (fc key `eldritch_invocations`, field `eldritch_invocations`, level 2) and Battle Master maneuver probes (fc key `maneuvers`, field `maneuvers_known`, level 3), reading ids from the data. (Read `eldritch_invocations.json` shape first; pick a few low-prereq invocation ids like `agonizing_blast`, `armor_of_shadows`; maneuvers from the Battle Master feature list / a maneuvers data source.)

- [ ] **Step 2-4: Implement `iter_external_option_probes()`**, then a parametrized smoke test that builds the prereq character and levels once choosing the option (as a single-element list for list-valued choices), asserting it lands in the top-level list field via `assert_option_landed`. TRIAGE failures (a dropped invocation/maneuver = real finding).

- [ ] **Step 5: Commit** `test(class-qa): external-list option coverage (invocations + maneuvers)`

---

### Task 3: ASI-vs-feat probes

**Files:**
- Test: `backend/tests/qa_classes/test_asi_feat.py`

- [ ] **Step 1-4:** At an ASI level (fighter L4), probe BOTH branches:
  - ASI: `level_up_once(id, "fighter", {"asiOrFeat": "asi", "asiChoices": {"strength": 2}})` → assert `ability_scores.strength` increased by 2 (build with known base). Note the grounded finding: the ASI path has **no +20 cap** — add a probe that raises STR from 19→21 and assert whether it caps at 20 (xfail if it doesn't, documenting the missing cap).
  - Feat: `level_up_once(id, "fighter", {"asiOrFeat": "feat", "featId": "<real feat id from feats.json>"})` → assert the feat id appears in `feats`.
- [ ] **Step 5: Commit** `test(class-qa): ASI-vs-feat probes (incl. missing-cap finding)`

---

## Self-Review checklist (run after writing tasks)
- Spec coverage: pact_boon/metamagic (Task 1), invocations/maneuvers (Task 2), ASI/feat (Task 3) — the full deferred set from Plan A/B's CHOICE_FIELD_MAP comment. ✅
- Real option ids confirmed against the data (no fabricated ids). 
- Findings (metamagic unsupported, ASI no-cap, any dropped invocation/maneuver) pinned with `xfail(strict=True)`, not masked.

## Next cycle — Plan D (reporting + CI)
`classifier.py` (failure → owner surface) + `scripts/class-qa/run_report.py` (owner-grouped `summary.md` under `artifacts/class-qa/<date>/`) + `scripts/class-qa/browser_smoke.md` (level-up wizard, ~3-4 classes) + CI wiring in `.github/workflows/quality-gate.yml`.
