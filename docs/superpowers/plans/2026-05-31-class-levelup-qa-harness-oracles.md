# Class / Level-Up QA Harness — Plan B (Deep Oracles + Multiclass) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the numeric/order bug-catching layers on top of Plan A's smoke harness: an independent SRD reference-tables module, a computed-invariant oracle (assert HP / slots / proficiency / resource caps per level), a differential oracle (incremental 1→20 vs direct build-at-level), and a small multiclass set — seeded with the three real candidate bugs found during design/grounding.

**Architecture:** Builds on `backend/tests/qa_classes/` (Plan A: `conftest.py`, `generator.py`, `drivers.py`, `oracles.py`, walk + probe tests, all green: 102 passed / 1 xfailed). Adds `reference_tables.py` (hardcoded SRD constants, reads NO app data), extends `oracles.py` with invariant + differential helpers, adds `test_multiclass.py`, and wires the invariant/differential checks into the existing progression walk.

**Tech Stack:** Same as Plan A — pytest + pytest-asyncio, httpx `AsyncClient`/`ASGITransport`, the existing `qa_*` fixtures.

**Scope note:** This is cycle B of the harness. The remaining lighter follow-ons — extending `CHOICE_FIELD_MAP` to invocations/feats/maneuvers/metamagic/pact_boon/ASI, the `classifier.py` + report layer, browser smoke, and CI wiring — are **Plan C**, deferred so Plan B stays focused on the deep oracle. See the design spec: [docs/superpowers/specs/2026-05-31-class-levelup-qa-harness-design.md](../specs/2026-05-31-class-levelup-qa-harness-design.md).

**Dev test command (no `--no-cov` — this venv has no pytest-cov):**
```bash
cd backend && source venv/bin/activate && TEST_DATABASE_URL=postgresql+asyncpg://haoli@localhost:5432/dnd_platform_test pytest tests/qa_classes/<file> -v -p no:cacheprovider
```

## Verified facts (grounded 2026-05-31 — these CORRECT the draft Task 2/3 code below; where they conflict, THESE win)

- **Sheet** `GET /api/characters/{id}/sheet` → `{character, features, actions, derived, ...}`. The `character` dict's computed-HP key is **`hit_points_max`** (NOT `max_hp`/`maxHp`) — [character_sheet_service.py:106](../../../backend/app/services/character_sheet_service.py). It also has `armor_class` but that is **base only** (`10 + DEX mod`, ignores equipped armor — [:193-199](../../../backend/app/services/character_sheet_service.py), a stubbed candidate finding). The sheet does **NOT** surface `proficiency_bonus`, `spell_save_dc`, `spell_attack_bonus`, or any attacks-per-action count → **do not assert proficiency from the sheet** (it's only computed per-weapon inside `actions[].attack_bonus`). The sheet's `_compute_max_hp` is **single-class only** (ignores `multiclass_data`), so for multiclass it disagrees with `calculate_max_hp` — another finding, but for the single-class walk `hit_points_max` IS the correct HP invariant target.
- **Resource caps**: use **`GET /api/characters/{id}/resources`** ([characters.py:3682](../../../backend/app/api/routes/characters.py)) — it computes each resource's `max` on the fly via `calculate_resource_max`, response `{"resources": [{"id", "max", "current", ...}], "abilities": [...]}`. Do NOT use `class_feature_uses` (it's `None` until a rest — **candidate bug #2**, but `/resources` sidesteps it, so **no long_rest is needed** in Task 2). Reference caps (independent): rage `{1:2,3:3,6:4,12:5,17:6}`, ki=level (monk L2+), sorcery_points=level (L2+), second_wind 1, action_surge `{2:1,17:2}`, lay_on_hands=level*5, bardic_inspiration=CHA mod, channel_divinity_cleric `{2:1,6:2,18:3}`.
- **Differential**: `CharacterCreate` (build-at-N) CANNOT set `feats` (not a create field), `metamagic` (exists nowhere), or nested `subclass_choices` keys `pactBoon`/`beastCompanion`/`elementalDisciplines`/`landType`/`familiarForm` (the `CharacterSubclassChoices` schema only has language/skills/cantrips/dragonType). So the diff subset must EXCLUDE those. `CharacterResponse` has **no max-HP field** → compare HP via each side's **sheet `hit_points_max`**, and compare the rest via the response fields (level, subclass_id, spell_slots_state, fighting_style, eldritch_invocations, maneuvers_known, expertise_skills). ASI: set as final `abilityScores` on create (no delta field).
- **Seed bugs** (all real): #1 multiclass max-die HP — [calculate_max_hp:124](../../../backend/app/services/character_progression_service.py) grants full die to the FIRST level of EVERY class entry (Fighter1/Wizard1 con0 → 16, 5e RAW = 14); #2 level-up never refreshes `class_feature_uses`; #3 multiclass half-caster artificer round-up house rule ([characters.py:408-411](../../../backend/app/api/routes/characters.py)). Also: sheet AC stub, sheet-vs-broadcast multiclass HP disagreement, spell_save_dc hardcoded to WIS mod regardless of class ([characters.py:4608](../../../backend/app/api/routes/characters.py)).
- HP deterministic (average). `pact_boon` nested under `subclass_choices["pactBoon"]`.

**Task 2/3 code below was drafted pre-grounding and uses `max_hp` + a long_rest + a `proficiency_bonus` sheet assertion. Apply these grounding corrections when implementing: (a) read `hit_points_max` from the sheet, not `max_hp`; (b) drop the proficiency-bonus-from-sheet assertion (not surfaced); (c) assert resource caps via `GET /{id}/resources` `max` fields instead of the long_rest + class_feature_uses path; (d) in the differential, compare HP via both sides' sheet `hit_points_max` and the rest via response fields (no `max_hp` in CharacterResponse).**

---

### Task 1: Independent SRD reference tables

**Files:**
- Create: `backend/tests/qa_classes/reference_tables.py`
- Test: `backend/tests/qa_classes/test_reference_tables.py`

**Independence rule:** this module hardcodes PHB/SRD values as constants. It must NOT import or read `classes.json`, `spellcasting.json`, `class_resources.json`, or `passive_features.json` — otherwise a wrong *data* value would self-agree with the code and pass. (No app-data imports at all.)

- [ ] **Step 1: Write the failing tests**

```python
# backend/tests/qa_classes/test_reference_tables.py
from tests.qa_classes import reference_tables as ref


def test_proficiency_bonus_by_total_level():
    assert ref.proficiency_bonus(1) == 2
    assert ref.proficiency_bonus(4) == 2
    assert ref.proficiency_bonus(5) == 3
    assert ref.proficiency_bonus(20) == 6


def test_hit_die():
    assert ref.HIT_DIE["barbarian"] == 12
    assert ref.HIT_DIE["wizard"] == 6
    assert ref.HIT_DIE["fighter"] == 10


def test_full_caster_slots():
    # wizard L1 -> one 1st-level slot vector index 1 == 2
    assert ref.FULL_CASTER_SLOTS[1][1] == 2
    assert ref.FULL_CASTER_SLOTS[5][3] == 2   # L5 full caster: two 3rd-level slots
    assert ref.FULL_CASTER_SLOTS[20][9] == 1  # L20: one 9th-level slot


def test_single_class_max_hp_average_rule():
    # fighter (d10), con +2, level 3: 10+2  +  (6+2)*2  = 12 + 16 = 28
    assert ref.single_class_max_hp("fighter", level=3, con_mod=2) == 28
    # wizard (d6), con 0, level 1: 6
    assert ref.single_class_max_hp("wizard", level=1, con_mod=0) == 6


def test_multiclass_max_hp_5e_rule_only_first_level_gets_max_die():
    # Fighter 1 / Wizard 1, con +2 (5e RAW): 10(max) + (6//2+1=4 avg) + 2*2 con = 18
    assert ref.multiclass_max_hp([("fighter", 1), ("wizard", 1)], con_mod=2) == 18
```

- [ ] **Step 2: Run, expect failure** (`ModuleNotFoundError`).

- [ ] **Step 3: Write `reference_tables.py`**

```python
# backend/tests/qa_classes/reference_tables.py
"""Independent PHB/SRD reference values for the invariant oracle.

HARDCODED on purpose — reads NO app data file. This is what lets the harness catch
*data* bugs (wrong value in classes.json / spellcasting.json), not just code bugs.
If you find yourself importing from app.utils.rules_cache here, stop: that defeats
the independence guarantee.
"""
from __future__ import annotations

HIT_DIE = {
    "barbarian": 12,
    "fighter": 10, "paladin": 10, "ranger": 10,
    "bard": 8, "cleric": 8, "druid": 8, "monk": 8, "rogue": 8, "warlock": 8,
    "sorcerer": 6, "wizard": 6,
}

FULL_CASTERS = {"bard", "cleric", "druid", "sorcerer", "wizard"}
HALF_CASTERS = {"paladin", "ranger"}  # spells start at L2


def proficiency_bonus(total_level: int) -> int:
    return 2 + (total_level - 1) // 4


# FULL_CASTER_SLOTS[caster_level] = [_, L1, L2, ..., L9]  (index 0 unused)
# PHB p.201 full-caster table.
FULL_CASTER_SLOTS = {
    1:  [0, 2, 0, 0, 0, 0, 0, 0, 0, 0],
    2:  [0, 3, 0, 0, 0, 0, 0, 0, 0, 0],
    3:  [0, 4, 2, 0, 0, 0, 0, 0, 0, 0],
    4:  [0, 4, 3, 0, 0, 0, 0, 0, 0, 0],
    5:  [0, 4, 3, 2, 0, 0, 0, 0, 0, 0],
    6:  [0, 4, 3, 3, 0, 0, 0, 0, 0, 0],
    7:  [0, 4, 3, 3, 1, 0, 0, 0, 0, 0],
    8:  [0, 4, 3, 3, 2, 0, 0, 0, 0, 0],
    9:  [0, 4, 3, 3, 3, 1, 0, 0, 0, 0],
    10: [0, 4, 3, 3, 3, 2, 0, 0, 0, 0],
    11: [0, 4, 3, 3, 3, 2, 1, 0, 0, 0],
    12: [0, 4, 3, 3, 3, 2, 1, 0, 0, 0],
    13: [0, 4, 3, 3, 3, 2, 1, 1, 0, 0],
    14: [0, 4, 3, 3, 3, 2, 1, 1, 0, 0],
    15: [0, 4, 3, 3, 3, 2, 1, 1, 1, 0],
    16: [0, 4, 3, 3, 3, 2, 1, 1, 1, 0],
    17: [0, 4, 3, 3, 3, 2, 1, 1, 1, 1],
    18: [0, 4, 3, 3, 3, 3, 1, 1, 1, 1],
    19: [0, 4, 3, 3, 3, 3, 2, 1, 1, 1],
    20: [0, 4, 3, 3, 3, 3, 2, 2, 1, 1],
}

# WARLOCK_PACT[warlock_level] = (slot_level, slot_count)  (pact magic, PHB p.107)
WARLOCK_PACT = {
    1: (1, 1), 2: (1, 2), 3: (2, 2), 4: (2, 2), 5: (3, 2), 6: (3, 2),
    7: (4, 2), 8: (4, 2), 9: (5, 2), 10: (5, 2), 11: (5, 3), 12: (5, 3),
    13: (5, 3), 14: (5, 3), 15: (5, 3), 16: (5, 3), 17: (5, 4), 18: (5, 4),
    19: (5, 4), 20: (5, 4),
}


def _avg_die(hit_die: int) -> int:
    return (hit_die // 2) + 1


def single_class_max_hp(class_id: str, level: int, con_mod: int) -> int:
    die = HIT_DIE[class_id]
    hp = die + con_mod                                   # level 1: max die
    if level > 1:
        hp += (_avg_die(die) + con_mod) * (level - 1)    # later levels: average
    return max(hp, level)


def multiclass_max_hp(entries: list[tuple[str, int]], con_mod: int) -> int:
    """5e RAW: ONLY the very first class level (character level 1) gets the max die.
    Every other level — including the first level of a secondary class — uses average.
    `entries` is ordered [(class_id, class_level), ...] with the first entry being the
    class taken at character level 1."""
    hp = 0
    total_level = sum(lvl for _, lvl in entries)
    for idx, (class_id, class_level) in enumerate(entries):
        die = HIT_DIE[class_id]
        levels_at_avg = class_level
        if idx == 0:
            hp += die + con_mod          # the one and only max-die level
            levels_at_avg = class_level - 1
        hp += (_avg_die(die) + con_mod) * levels_at_avg
    return max(hp, total_level)
```

- [ ] **Step 4: Run, expect PASS (5 passed).** If `FULL_CASTER_SLOTS` values are questioned, they are the canonical PHB p.201 table — do not change them to match app data.

- [ ] **Step 5: Commit**
```bash
cd /Users/haoli/leehow/code/dw && git add backend/tests/qa_classes/reference_tables.py backend/tests/qa_classes/test_reference_tables.py
git commit -m "test(class-qa): independent SRD reference tables (slots/HP/proficiency)"
```

---

### Task 2: Computed-invariant oracle + wire into the walk

**Files:**
- Modify: `backend/tests/qa_classes/oracles.py` (add invariant helpers)
- Modify: `backend/tests/qa_classes/drivers.py` (add a `long_rest` driver)
- Modify: `backend/tests/qa_classes/test_progression_walk.py` (assert invariants at L20)
- Test: `backend/tests/qa_classes/test_oracles_invariant.py`

- [ ] **Step 1: Find the rest endpoint** (the resource-cap invariant needs a long rest first, since level-up leaves `class_feature_uses` stale — candidate bug #2).

Run: `cd backend && grep -nE "@router\.(post\|put).*rest|def .*rest" app/api/routes/characters.py app/api/routes/character_*.py`
Record the exact path (likely `POST /api/characters/{id}/rest` with a body like `{"rest_type": "long"}` or `{"type": "long"}`). Confirm the request body shape by reading the handler. Use the confirmed path/body in Step 3's `long_rest` driver.

- [ ] **Step 2: Write the failing invariant test** (pure-logic part — assert the oracle compares sheet fields to reference tables)

```python
# backend/tests/qa_classes/test_oracles_invariant.py
import pytest
from tests.qa_classes import oracles


def test_assert_single_class_invariants_passes_on_correct_sheet():
    sheet_char = {
        "level": 3, "class_id": "fighter", "max_hp": 28,
        "proficiency_bonus": 2, "armor_class": 10,
    }
    # con_mod 2, fighter L3 -> max_hp 28, prof 2. No raise.
    oracles.assert_single_class_invariants(
        sheet_char, class_id="fighter", level=3, con_mod=2, context="fighter L3")


def test_assert_single_class_invariants_flags_wrong_hp():
    sheet_char = {"level": 3, "class_id": "fighter", "max_hp": 999,
                  "proficiency_bonus": 2, "armor_class": 10}
    with pytest.raises(AssertionError, match="max_hp"):
        oracles.assert_single_class_invariants(
            sheet_char, class_id="fighter", level=3, con_mod=2, context="fighter L3")


def test_assert_resource_caps_flags_stale_cap():
    # reference says barbarian L3 has 3 rages; a stale level-1 value (2) must flag.
    with pytest.raises(AssertionError, match="rage"):
        oracles.assert_resource_cap(
            class_feature_uses={"rage": {"current": 2, "max": 2}},
            resource_id="rage", expected_max=3, context="barbarian L3 rage")
```

- [ ] **Step 3: Implement the invariant oracle + long_rest driver**

Add to `backend/tests/qa_classes/oracles.py`:
```python
from tests.qa_classes import reference_tables as ref


def assert_single_class_invariants(sheet_char: dict, *, class_id: str, level: int,
                                   con_mod: int, context: str) -> None:
    """Assert the sheet's computed derived stats match the independent SRD tables."""
    expected_hp = ref.single_class_max_hp(class_id, level, con_mod)
    actual_hp = sheet_char.get("max_hp")
    assert actual_hp == expected_hp, (
        f"[FAIL] {context}: max_hp {actual_hp} != expected {expected_hp}")
    expected_pb = ref.proficiency_bonus(level)
    actual_pb = sheet_char.get("proficiency_bonus")
    assert actual_pb == expected_pb, (
        f"[FAIL] {context}: proficiency_bonus {actual_pb} != expected {expected_pb}")


def assert_resource_cap(class_feature_uses: dict, *, resource_id: str,
                        expected_max: int, context: str) -> None:
    entry = (class_feature_uses or {}).get(resource_id) or {}
    actual = entry.get("max")
    assert actual == expected_max, (
        f"[FAIL] {context}: resource '{resource_id}' max {actual} != expected {expected_max}")
```

Add to `backend/tests/qa_classes/drivers.py` (use the path/body confirmed in Step 1 — example shown; ADJUST to the real shape):
```python
async def long_rest(client: AsyncClient, headers: dict, character_id: int) -> Response:
    # NOTE: confirm the real path + body in Step 1; this is the expected shape.
    return await client.post(
        f"{API}/{character_id}/rest", json={"rest_type": "long"}, headers=headers)
```

- [ ] **Step 4: Run the pure-logic test, expect PASS (3 passed).**
Run: `... pytest tests/qa_classes/test_oracles_invariant.py -v -p no:cacheprovider`

- [ ] **Step 5: Wire invariants into the walk** — in `test_progression_walk.py`, after the L20 walk, fetch the sheet and assert single-class HP/proficiency invariants. con_mod is 0 (the harness builds with default ability_scores all 10 → con_mod 0). Add to `test_full_breadth_walks`:

```python
    # invariant layer: the L20 sheet's derived stats match the independent SRD tables
    sheet = await drivers.get_sheet(qa_client, qa_headers, char["id"])
    oracles.assert_status_ok(sheet, f"sheet {pair.class_id}/{pair.subclass_id}")
    oracles.assert_single_class_invariants(
        sheet.json()["character"], class_id=pair.class_id, level=20, con_mod=0,
        context=f"{pair.class_id}/{pair.subclass_id} L20")
```

- [ ] **Step 6: Run the full walk; TRIAGE.** A wrong `max_hp`/`proficiency_bonus` at L20 is a real finding (record class/subclass + actual vs expected). Do NOT weaken. If `max_hp` is `None` in the sheet, confirm the sheet field name via Step-1-style reading (it should be `max_hp`).
Run: `... pytest tests/qa_classes/test_progression_walk.py -k full_breadth -p no:cacheprovider`

- [ ] **Step 7: Commit**
```bash
cd /Users/haoli/leehow/code/dw && git add backend/tests/qa_classes/oracles.py backend/tests/qa_classes/drivers.py backend/tests/qa_classes/test_progression_walk.py backend/tests/qa_classes/test_oracles_invariant.py
git commit -m "test(class-qa): computed-invariant oracle (HP/proficiency vs SRD) wired into walk"
```

---

### Task 3: Differential oracle (incremental vs build-at-level)

**Files:**
- Modify: `backend/tests/qa_classes/oracles.py` (add `assert_walk_matches_build`)
- Modify: `backend/tests/qa_classes/test_progression_walk.py` (one differential test)
- Test: `backend/tests/qa_classes/test_oracles_invariant.py` (add a pure-logic diff test)

The differential compares a SAFE SUBSET both paths populate identically (metamagic, ASI, and `class_feature_uses` are excluded — they diverge by construction; see Verified facts).

- [ ] **Step 1: Write the failing pure-logic diff test** (append to `test_oracles_invariant.py`)

```python
def test_assert_walk_matches_build_flags_subset_diff():
    walked = {"level": 20, "subclass_id": "champion", "max_hp": 200,
              "fighting_style": "archery", "spell_slots_state": None,
              "eldritch_invocations": [], "maneuvers_known": [], "expertise_skills": []}
    built = dict(walked, max_hp=195)  # diverging HP
    with pytest.raises(AssertionError, match="max_hp"):
        oracles.assert_walk_matches_build(walked, built, context="fighter/champion")
```

- [ ] **Step 2: Implement `assert_walk_matches_build` in `oracles.py`**

```python
_DIFF_FIELDS = ("level", "subclass_id", "max_hp", "spell_slots_state",
                "fighting_style", "eldritch_invocations", "maneuvers_known",
                "expertise_skills")


def assert_walk_matches_build(walked: dict, built: dict, *, context: str) -> None:
    """Compare the SAFE SUBSET of derived state between an incrementally-leveled
    character and one built directly at the same level. Excludes metamagic / ASI /
    class_feature_uses, which legitimately differ between the two endpoints."""
    diffs = []
    for f in _DIFF_FIELDS:
        if walked.get(f) != built.get(f):
            diffs.append(f"{f}: walk={walked.get(f)!r} build={built.get(f)!r}")
    assert not diffs, f"[FAIL] {context}: walk vs build-at-level diverged:\n  " + "\n  ".join(diffs)
```

- [ ] **Step 3: Run pure-logic test, expect PASS.**

- [ ] **Step 4: Add the end-to-end differential test** to `test_progression_walk.py` (a focused set, not all 40 — pick 4 representative subclasses to keep runtime sane: fighter/champion, wizard/evocation, cleric/life, rogue/thief). For each: run the 1→20 walk (returns the walked character json), then build a L20 character directly with the same canonical choices, then compare.

```python
@pytest.mark.parametrize("class_id,subclass_id", [
    ("fighter", "champion"), ("wizard", "evocation"),
    ("cleric", "life"), ("rogue", "thief"),
])
async def test_walk_matches_direct_build(qa_client, qa_headers, qa_user_id, class_id, subclass_id):
    walked = await _walk(qa_client, qa_headers, qa_user_id, class_id, subclass_id)
    # build the same character directly at L20 with the canonical choices
    script = build_choice_script(class_id, subclass_id)
    flat = {}
    for level_choices in script.values():
        flat.update(level_choices)
    l20_subclass = flat.pop("subclass", None)
    built_resp = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, class_id, level=20,
        subclass_id=l20_subclass, choices=flat or None)
    oracles.assert_status_ok(built_resp, f"build-at-20 {class_id}/{subclass_id}")
    oracles.assert_walk_matches_build(
        walked, built_resp.json(), context=f"{class_id}/{subclass_id}")
```

Note the `subclass_id` mismatch the verify code names: the subclass `WalkPath.subclass_id` ids here (`champion`, `evocation`, `life`, `thief`) must match the real progression option ids — confirm via `python3 -c "from tests.qa_classes.generator import iter_class_subclass_pairs; print([p for p in iter_class_subclass_pairs() if p.class_id in {'cleric','rogue','wizard','fighter'}])"` and adjust the parametrize ids to real ones if any differ.

- [ ] **Step 5: Run; TRIAGE.** A subset-field divergence is a real finding (the two endpoints applied the same choices differently). Record it. Do NOT add the excluded fields back to force green.
Run: `... pytest tests/qa_classes/test_progression_walk.py -k walk_matches -p no:cacheprovider`

- [ ] **Step 6: Commit**
```bash
cd /Users/haoli/leehow/code/dw && git add backend/tests/qa_classes/oracles.py backend/tests/qa_classes/test_progression_walk.py backend/tests/qa_classes/test_oracles_invariant.py
git commit -m "test(class-qa): differential oracle (incremental walk vs build-at-level)"
```

---

### Task 4: Multiclass set + seed bugs #1 / #3 (and surface #2)

**Files:**
- Create: `backend/tests/qa_classes/test_multiclass.py`

These tests target the three real candidate bugs. They are written to ASSERT THE CORRECT (SRD) behavior, so they will FAIL against the current code — that is the point. Mark the ones expected to fail today with `xfail(strict=True)` and a clear reason, so they flip to an error the moment the bug is fixed.

- [ ] **Step 1: Confirm the multiclass level-up shape.** Multiclass is driven by calling `level_up_once(char_id, class_choice=<other_class>, {})` — `class_choice` differing from the character's `class_id` adds a multiclass entry ([apply_level_up_class_choice](../../../backend/app/services/character_progression_service.py:89)). Confirm a fighter can multiclass into wizard via `level_up_once(id, "wizard", {})` and the response's `multiclass_data.classes` gains a wizard entry. Write a quick assertion in Step 2's first test.

- [ ] **Step 2: Write the multiclass tests**

```python
# backend/tests/qa_classes/test_multiclass.py
"""Representative multiclass combos targeting the three grounded candidate bugs:
#1 calculate_max_hp gives max die to EVERY class's first level (should be only the
   very first character level);
#2 level-up does not refresh class_feature_uses (resource caps go stale);
#3 half-caster multiclass spell-slot rounding inconsistency.
Tests assert the CORRECT 5e behavior, so the ones that currently fail are xfail(strict)."""
import pytest
from tests.qa_classes import drivers, oracles, reference_tables as ref

pytestmark = [pytest.mark.asyncio]


async def _multiclass_fighter_then(qa_client, qa_headers, qa_user_id, second_class):
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "fighter", level=1)
    oracles.assert_status_ok(created, "create fighter L1")
    resp = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], second_class, {})
    oracles.assert_status_ok(resp, f"fighter -> {second_class} multiclass")
    return resp.json()


async def test_multiclass_adds_second_class_entry(qa_client, qa_headers, qa_user_id):
    char = await _multiclass_fighter_then(qa_client, qa_headers, qa_user_id, "wizard")
    classes = (char.get("multiclass_data") or {}).get("classes") or []
    ids = {c.get("class_id") for c in classes}
    assert ids == {"fighter", "wizard"}, f"expected fighter+wizard, got {ids}"
    assert char["level"] == 2


@pytest.mark.xfail(reason="seed bug #1: calculate_max_hp gives max hit die to the first "
                          "level of EVERY class; 5e gives it only to the very first level",
                   strict=True)
async def test_multiclass_first_level_hp_uses_5e_rule(qa_client, qa_headers, qa_user_id):
    char = await _multiclass_fighter_then(qa_client, qa_headers, qa_user_id, "wizard")
    sheet = await drivers.get_sheet(qa_client, qa_headers, char["id"])
    oracles.assert_status_ok(sheet, "sheet fighter/wizard")
    # default abilities all 10 -> con_mod 0. 5e RAW: fighter1 max(10) + wizard1 avg(4) = 14.
    expected = ref.multiclass_max_hp([("fighter", 1), ("wizard", 1)], con_mod=0)  # == 14
    assert sheet.json()["character"]["max_hp"] == expected
```

- [ ] **Step 3: Run; interpret.** `test_multiclass_first_level_hp_uses_5e_rule` should `xfail` (current code returns 16, not 14). If it `xpasses` (returns 14), the bug is already fixed — flip to a plain assertion. The `test_multiclass_adds_second_class_entry` should pass. Add 2-3 more combos from spec §4 (wizard/cleric full+full slot stacking via `assert` against `ref.FULL_CASTER_SLOTS`, paladin/warlock pact+slots) following the same pattern; mark any that fail against current code as `xfail(strict=True)` with the specific bug.
Run: `... pytest tests/qa_classes/test_multiclass.py -v -p no:cacheprovider`

- [ ] **Step 4: Commit**
```bash
cd /Users/haoli/leehow/code/dw && git add backend/tests/qa_classes/test_multiclass.py
git commit -m "test(class-qa): multiclass set targeting seed bugs #1/#2/#3"
```

---

## Self-Review

- **Spec coverage**: §1 invariant layer → Tasks 1-2; §1 differential → Task 3; §4 multiclass + §6 seed bugs → Task 4. Report/browser/CI + CHOICE_FIELD_MAP option-extension → Plan C (named, not silently dropped). ✅
- **Placeholders**: the `long_rest` path and a couple of line numbers carry explicit "confirm in Step 1" actions (real reads, not vague TODOs) — these are genuinely environment-confirmed at implementation time, not fabricated. ✅
- **Independence**: `reference_tables.py` imports no app data (Task 1 note). ✅
- **Type consistency**: `single_class_max_hp(class_id, level, con_mod)`, `multiclass_max_hp(entries, con_mod)`, `proficiency_bonus(total_level)`, `assert_single_class_invariants(sheet_char, *, class_id, level, con_mod, context)`, `assert_resource_cap(...)`, `assert_walk_matches_build(walked, built, *, context)` — names consistent across Tasks 1-4. ✅

## Next cycle — Plan C (coverage breadth + reporting)
1. Extend `CHOICE_FIELD_MAP` / generator to invocations (`eldritch_invocations.json`), feats (`feats.json`), maneuvers, metamagic, expertise, ASI, and pact_boon (nested under `subclass_choices["pactBoon"]` — needs `option_landed` nested-field support).
2. Resource-cap invariant after a long rest across all classes (exercises candidate bug #2 at breadth).
3. `classifier.py` + `scripts/class-qa/run_report.py` → owner-classified `summary.md`.
4. `scripts/class-qa/browser_smoke.md` (level-up wizard, ~3-4 classes).
5. CI wiring in `.github/workflows/quality-gate.yml`.
