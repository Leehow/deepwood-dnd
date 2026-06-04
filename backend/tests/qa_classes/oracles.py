"""Smoke-layer assertions for the class/level-up QA harness.

`assert_status_ok` treats any 5xx as a hard failure (a real app bug) and a 4xx as a
softer failure surfaced with the response body. `option_landed` normalizes the three
shapes a chosen option can take in a CharacterResponse: a bare string, a dict with a
`value`/`id` key, or a list of those.
"""
from __future__ import annotations
from typing import Any
from tests.qa_classes import reference_tables as ref


def assert_status_ok(resp, context: str) -> None:
    assert resp.status_code < 500, (
        f"[BLOCKED_BY_APP_BUG] {context}: HTTP {resp.status_code}\n{resp.text}"
    )
    assert resp.status_code < 400, (
        f"[FAIL] {context}: HTTP {resp.status_code}\n{resp.text}"
    )


def _ids_in(value: Any) -> set[str]:
    if value is None:
        return set()
    if isinstance(value, str):
        return {value}
    if isinstance(value, dict):
        return {str(value[k]) for k in ("value", "id") if value.get(k) is not None}
    if isinstance(value, list):
        out: set[str] = set()
        for item in value:
            out |= _ids_in(item)
        return out
    return set()


def _resolve_path(obj, path: str):
    cur = obj
    for part in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def option_landed(character_json: dict, field: str, option_id: str) -> bool:
    return option_id in _ids_in(_resolve_path(character_json, field))


def assert_option_landed(character_json: dict, field: str, option_id: str,
                         context: str) -> None:
    assert option_landed(character_json, field, option_id), (
        f"[FAIL] {context}: option '{option_id}' did not land in "
        f"character['{field}'] = {character_json.get(field)!r}"
    )


def assert_hp_invariant(sheet_char: dict, *, class_id: str, level: int,
                        con_mod: int, context: str) -> None:
    expected = ref.single_class_max_hp(class_id, level, con_mod)
    actual = sheet_char.get("hit_points_max")
    assert actual == expected, (
        f"[FAIL] {context}: sheet hit_points_max {actual} != SRD expected {expected}")


def assert_full_caster_slots(spell_slots_state, *, level: int, context: str) -> None:
    expected = ref.FULL_CASTER_SLOTS[level]
    assert list(spell_slots_state or []) == expected, (
        f"[FAIL] {context}: spell_slots_state {spell_slots_state} != SRD full-caster {expected}")


def assert_resource_cap(resources_json: dict, *, resource_id: str,
                        expected_max: int, context: str) -> None:
    by_id = {r.get("id"): r for r in (resources_json or {}).get("resources", [])}
    entry = by_id.get(resource_id)
    assert entry is not None, f"[FAIL] {context}: resource '{resource_id}' not in /resources"
    actual = entry.get("max")
    assert actual == expected_max, (
        f"[FAIL] {context}: resource '{resource_id}' max {actual} != SRD expected {expected_max}")


_DIFF_FIELDS = ("level", "subclass_id", "spell_slots_state", "fighting_style",
                "eldritch_invocations", "maneuvers_known", "expertise_skills")


def assert_walk_matches_build(walked: dict, built: dict, *, walked_hp, built_hp,
                              context: str) -> None:
    """Compare the SAFE SUBSET both the incremental-level-up and direct-build paths
    populate. Excludes feats / metamagic / nested subclass_choices (create can't set
    them). HP is passed in from each side's sheet hit_points_max (CharacterResponse has
    no max-HP field)."""
    diffs = []
    for f in _DIFF_FIELDS:
        if walked.get(f) != built.get(f):
            diffs.append(f"{f}: walk={walked.get(f)!r} build={built.get(f)!r}")
    if walked_hp != built_hp:
        diffs.append(f"hit_points_max: walk={walked_hp} build={built_hp}")
    assert not diffs, (
        f"[FAIL] {context}: incremental walk vs build-at-level diverged:\n  "
        + "\n  ".join(diffs)
    )
