"""pact_boon lands nested under subclass_choices.pactBoon; metamagic now lands under
subclass_choices.metamagic (bug #3 fixed — was previously silently dropped)."""
import pytest
from tests.qa_classes import drivers, oracles

pytestmark = [pytest.mark.asyncio]

WARLOCK_SUBCLASS = "fiend"        # confirmed from iter_class_subclass_pairs
SORCERER_SUBCLASS = "draconic"    # confirmed from iter_class_subclass_pairs
PACT_BOON_ID = "blade"            # from warlock L3 pact_boon node choices (chain/blade/tome)


async def test_warlock_pact_boon_lands_nested(qa_client, qa_headers, qa_user_id):
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "warlock",
                                           level=2, subclass_id=WARLOCK_SUBCLASS)
    oracles.assert_status_ok(created, "create warlock L2")
    lv3 = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "warlock",
                                      {"pact_boon": PACT_BOON_ID})
    oracles.assert_status_ok(lv3, "warlock L3 pact_boon")
    oracles.assert_option_landed(lv3.json(), "subclass_choices.pactBoon", PACT_BOON_ID,
                                 f"warlock {PACT_BOON_ID}")


async def test_sorcerer_metamagic_lands(qa_client, qa_headers, qa_user_id):
    """Regression guard for FIXED bug #3: metamagic now persists to
    subclass_choices.metamagic (same pattern as elemental_disciplines)."""
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, "sorcerer",
                                           level=2, subclass_id=SORCERER_SUBCLASS)
    oracles.assert_status_ok(created, "create sorcerer L2")
    lv3 = await drivers.level_up_once(qa_client, qa_headers, created.json()["id"], "sorcerer",
                                      {"metamagic": ["quickened"]})
    oracles.assert_status_ok(lv3, "sorcerer L3 metamagic")
    oracles.assert_option_landed(lv3.json(), "subclass_choices.metamagic", "quickened",
                                 "sorcerer metamagic quickened")
