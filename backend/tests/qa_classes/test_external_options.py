"""Coverage for external-list option types: warlock eldritch invocations and Battle
Master maneuvers (ids come from data files, not inline in the choice node).

Confirmed IDs (2026-05-31):
- Invocations without prerequisite (level 0): armor_of_shadows, beast_speech,
  beguiling_influence, devils_sight, eldritch_sight
  (from frontend/app/data/rules/eldritch_invocations.json)
- Battle Master subclass id: battle_master
  (fighter subclass chosen at L3 via feature_choices["subclass"])
- Maneuver ids: trip_attack, riposte, menacing_attack, precision_attack, parry
  (from frontend/app/data/backend/class_resources.json resourceAbilities)
"""
import pytest
from tests.qa_classes import drivers, oracles

pytestmark = [pytest.mark.asyncio]

# Parametrized cases: warlock invocations (no prerequisite, level 0).
# Build warlock at L1 with subclass, then level_up to L2 picking the invocation.
# (class_id, subclass_id, build_level, levelup_to, fc_key, char_field, option_id)
INVOCATION_CASES = [
    ("warlock", "fiend", 1, 2, "eldritch_invocations", "eldritch_invocations", "armor_of_shadows"),
    ("warlock", "fiend", 1, 2, "eldritch_invocations", "eldritch_invocations", "beast_speech"),
    ("warlock", "fiend", 1, 2, "eldritch_invocations", "eldritch_invocations", "beguiling_influence"),
]


@pytest.mark.parametrize("case", INVOCATION_CASES, ids=[c[6] for c in INVOCATION_CASES])
async def test_eldritch_invocation_lands(qa_client, qa_headers, qa_user_id, case):
    """Warlock gains eldritch invocations starting at L2.
    Build at L1 (with subclass), level_up to L2 passing invocation id, assert it
    appears in character.eldritch_invocations list."""
    class_id, subclass_id, build_level, levelup_to, fc_key, field, option_id = case

    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, class_id,
        level=build_level, subclass_id=subclass_id,
    )
    oracles.assert_status_ok(created, f"create {class_id} L{build_level}")

    resp = await drivers.level_up_once(
        qa_client, qa_headers, created.json()["id"], class_id,
        {fc_key: [option_id]},
    )
    oracles.assert_status_ok(resp, f"{class_id} L{levelup_to} {fc_key}={option_id}")
    oracles.assert_option_landed(resp.json(), field, option_id,
                                 f"warlock invocation {option_id}")


async def test_battle_master_maneuver_lands(qa_client, qa_headers, qa_user_id):
    """Battle Master subclass is chosen at L3 and maneuvers are granted at L3.
    Build fighter at L2, level_up to L3 passing subclass AND maneuvers together,
    assert trip_attack appears in character.maneuvers_known."""
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=2,
    )
    oracles.assert_status_ok(created, "create fighter L2")

    resp = await drivers.level_up_once(
        qa_client, qa_headers, created.json()["id"], "fighter",
        {"subclass": "battle_master", "maneuvers": ["trip_attack"]},
    )
    oracles.assert_status_ok(resp, "fighter L3 battle_master + trip_attack maneuver")
    oracles.assert_option_landed(resp.json(), "maneuvers_known", "trip_attack",
                                 "BM maneuver trip_attack")


async def test_battle_master_multiple_maneuvers_land(qa_client, qa_headers, qa_user_id):
    """Battle Master at L3 grants 3 maneuvers. Verify two of them land when passed."""
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=2,
    )
    oracles.assert_status_ok(created, "create fighter L2 (multi-maneuver)")

    resp = await drivers.level_up_once(
        qa_client, qa_headers, created.json()["id"], "fighter",
        {"subclass": "battle_master", "maneuvers": ["riposte", "precision_attack"]},
    )
    oracles.assert_status_ok(resp, "fighter L3 battle_master + 2 maneuvers")
    char = resp.json()
    oracles.assert_option_landed(char, "maneuvers_known", "riposte",
                                 "BM maneuver riposte")
    oracles.assert_option_landed(char, "maneuvers_known", "precision_attack",
                                 "BM maneuver precision_attack")
