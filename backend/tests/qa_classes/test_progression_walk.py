# backend/tests/qa_classes/test_progression_walk.py
"""1->20 progression walk per (class, subclass): smoke-assert no 500 at each level.

The Phase 0 self-test (fighter/wizard/warlock) is the bring-up subset; the full
parametrization is the breadth sweep. A determinism test reruns one walk and asserts
the final character subset is identical."""
import pytest
from tests.qa_classes import drivers, oracles, reference_tables as ref
from tests.qa_classes.generator import iter_class_subclass_pairs, build_choice_script

pytestmark = [pytest.mark.asyncio]

PAIRS = iter_class_subclass_pairs()
SELF_TEST = {"fighter", "wizard", "warlock"}


async def _walk(qa_client, qa_headers, qa_user_id, class_id, subclass_id) -> dict:
    script = build_choice_script(class_id, subclass_id)
    # CREATE takes the subclass via the `subclass_id` field, but the script emits it
    # under the level-up key "subclass". Route an L1 subclass to subclass_id.
    l1 = dict(script.get(1) or {})
    l1_subclass = l1.pop("subclass", None)
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, class_id, level=1,
        subclass_id=l1_subclass, choices=l1 or None)
    oracles.assert_status_ok(created, f"create {class_id}/{subclass_id} L1")
    char = created.json()
    for level in range(2, 21):
        resp = await drivers.level_up_once(
            qa_client, qa_headers, char["id"], class_id, script.get(level, {}))
        oracles.assert_status_ok(resp, f"{class_id}/{subclass_id} -> L{level}")
        char = resp.json()
        assert char["level"] == level, f"{class_id}/{subclass_id}: expected L{level}, got {char['level']}"
    return char


@pytest.mark.parametrize(
    "pair", [p for p in PAIRS if p.class_id in SELF_TEST],
    ids=lambda p: f"{p.class_id}.{p.subclass_id}")
async def test_self_test_walks(qa_client, qa_headers, qa_user_id, pair):
    """Phase 0 bring-up: fighter/wizard/warlock subclasses walk 1->20 cleanly."""
    await _walk(qa_client, qa_headers, qa_user_id, pair.class_id, pair.subclass_id)


@pytest.mark.parametrize("pair", PAIRS, ids=lambda p: f"{p.class_id}.{p.subclass_id}")
async def test_full_breadth_walks(qa_client, qa_headers, qa_user_id, pair):
    """Phase 1 breadth: every (class, subclass) walks 1->20 with no 500."""
    char = await _walk(qa_client, qa_headers, qa_user_id, pair.class_id, pair.subclass_id)
    assert char["subclass_id"] == pair.subclass_id
    sheet = await drivers.get_sheet(qa_client, qa_headers, char["id"])
    oracles.assert_status_ok(sheet, f"sheet {pair.class_id}/{pair.subclass_id}")
    sheet_char = sheet.json()["character"]
    oracles.assert_hp_invariant(sheet_char, class_id=pair.class_id, level=20,
                                con_mod=0, context=f"{pair.class_id}/{pair.subclass_id} L20")
    if pair.class_id in ref.FULL_CASTERS:
        # spell_slots_state is CURRENT slots; it equals the full max here only because
        # QA walks never expend slots. If a future walk casts, switch to a max source.
        oracles.assert_full_caster_slots(char.get("spell_slots_state"), level=20,
                                         context=f"{pair.class_id}/{pair.subclass_id} L20 slots")


async def test_walk_is_deterministic(qa_client, qa_headers, qa_user_id):
    keys = ("level", "class_id", "subclass_id", "fighting_style", "spell_slots_state")
    a = await _walk(qa_client, qa_headers, qa_user_id, "fighter", "champion")
    b = await _walk(qa_client, qa_headers, qa_user_id, "fighter", "champion")
    assert {k: a.get(k) for k in keys} == {k: b.get(k) for k in keys}
