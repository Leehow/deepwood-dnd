"""ASI-vs-feat probes at a fighter ASI level (L4), including a regression guard that the
ASI path caps ability scores at 20 (fixed)."""
import pytest
from tests.qa_classes import drivers, oracles

pytestmark = [pytest.mark.asyncio]

# Real feat id verified from frontend/app/data/rules/feats.json — no sub-choice required.
_ALERT_FEAT_ID = "alert"


async def _fighter_at_3_with_str(qa_client, qa_headers, qa_user_id, strength):
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=3,
        choices={"ability_scores": {"strength": strength, "dexterity": 10,
                                    "constitution": 10, "intelligence": 10,
                                    "wisdom": 10, "charisma": 10}})
    oracles.assert_status_ok(created, f"create fighter L3 str{strength}")
    return created.json()


async def test_asi_increases_ability(qa_client, qa_headers, qa_user_id):
    char = await _fighter_at_3_with_str(qa_client, qa_headers, qa_user_id, 14)
    # Verify starting strength landed
    assert char["ability_scores"]["strength"] == 14, \
        f"starting STR: expected 14, got {char['ability_scores']['strength']}"

    resp = await drivers.level_up_once(qa_client, qa_headers, char["id"], "fighter",
                                       {"asiOrFeat": "asi", "asiChoices": {"strength": 2}})
    oracles.assert_status_ok(resp, "fighter L4 ASI +2 str")
    assert resp.json()["ability_scores"]["strength"] == 16, \
        f"expected 16, got {resp.json()['ability_scores']['strength']}"


async def test_feat_lands_in_feats(qa_client, qa_headers, qa_user_id):
    char = await _fighter_at_3_with_str(qa_client, qa_headers, qa_user_id, 14)
    resp = await drivers.level_up_once(qa_client, qa_headers, char["id"], "fighter",
                                       {"asiOrFeat": "feat", "featId": _ALERT_FEAT_ID})
    oracles.assert_status_ok(resp, "fighter L4 feat (alert)")
    oracles.assert_option_landed(resp.json(), "feats", _ALERT_FEAT_ID, "fighter feat alert")


async def test_asi_respects_20_cap(qa_client, qa_headers, qa_user_id):
    char = await _fighter_at_3_with_str(qa_client, qa_headers, qa_user_id, 19)
    resp = await drivers.level_up_once(qa_client, qa_headers, char["id"], "fighter",
                                       {"asiOrFeat": "asi", "asiChoices": {"strength": 2}})
    oracles.assert_status_ok(resp, "fighter L4 ASI 19->cap")
    assert resp.json()["ability_scores"]["strength"] == 20, "ASI should cap STR at 20"
