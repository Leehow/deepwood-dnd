"""Pure-logic unit tests for the computed-invariant oracle helpers.

No database / HTTP required — all inputs are hardcoded. These tests verify the
oracle functions themselves (pass/fail branching), not the app.
"""
import pytest
from tests.qa_classes import oracles


def test_assert_hp_invariant_passes_and_flags():
    # fighter L20 con_mod 0: 10 + (6)*19 = 124
    oracles.assert_hp_invariant({"hit_points_max": 124}, class_id="fighter", level=20,
                                con_mod=0, context="fighter L20")
    with pytest.raises(AssertionError, match="hit_points_max"):
        oracles.assert_hp_invariant({"hit_points_max": 999}, class_id="fighter", level=20,
                                    con_mod=0, context="fighter L20")


def test_assert_full_caster_slots_passes_and_flags():
    good = [0, 4, 3, 3, 3, 3, 2, 2, 1, 1]   # FULL_CASTER_SLOTS[20]
    oracles.assert_full_caster_slots(good, level=20, context="wizard L20")
    with pytest.raises(AssertionError, match="spell_slots"):
        oracles.assert_full_caster_slots([0, 1, 0, 0, 0, 0, 0, 0, 0, 0], level=20,
                                         context="wizard L20")


def test_assert_resource_cap_passes_and_flags():
    resources = {"resources": [{"id": "rage", "max": 6}, {"id": "second_wind", "max": 1}]}
    oracles.assert_resource_cap(resources, resource_id="rage", expected_max=6, context="barb L20")
    with pytest.raises(AssertionError, match="rage"):
        oracles.assert_resource_cap(resources, resource_id="rage", expected_max=3, context="barb L20")


def test_assert_walk_matches_build_flags_diffs():
    walked = {"level": 20, "subclass_id": "champion", "spell_slots_state": None,
              "fighting_style": "archery", "eldritch_invocations": [],
              "maneuvers_known": [], "expertise_skills": []}
    built = dict(walked)
    oracles.assert_walk_matches_build(walked, built, walked_hp=124, built_hp=124,
                                      context="fighter/champion")  # no raise
    with pytest.raises(AssertionError, match="hit_points_max"):
        oracles.assert_walk_matches_build(walked, built, walked_hp=124, built_hp=120,
                                          context="fighter/champion")
    with pytest.raises(AssertionError, match="subclass_id"):
        oracles.assert_walk_matches_build(walked, dict(built, subclass_id="x"),
                                          walked_hp=1, built_hp=1, context="c")
