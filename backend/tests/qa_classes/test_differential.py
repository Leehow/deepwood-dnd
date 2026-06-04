"""Differential oracle: a character leveled 1->20 incrementally must match one built
directly at L20 with the same canonical choices (safe subset). The two go through
different endpoints/code, so a divergence is a real order-dependent / clobber bug."""
import pytest
from tests.qa_classes import drivers, oracles
from tests.qa_classes.generator import iter_class_subclass_pairs, build_choice_script

pytestmark = [pytest.mark.asyncio]


def _representatives():
    """One real (class, subclass) per representative class, taken from the data."""
    pairs = iter_class_subclass_pairs()
    reps = []
    for cid in ("fighter", "wizard", "cleric", "rogue"):
        m = next((p for p in pairs if p.class_id == cid), None)
        if m:
            reps.append(m)
    return reps


REPS = _representatives()


async def _walk_to_20(qa_client, qa_headers, qa_user_id, class_id, subclass_id) -> dict:
    script = build_choice_script(class_id, subclass_id)
    l1 = dict(script.get(1) or {})
    l1_sub = l1.pop("subclass", None)
    created = await drivers.build_at_level(qa_client, qa_headers, qa_user_id, class_id,
                                           level=1, subclass_id=l1_sub, choices=l1 or None)
    oracles.assert_status_ok(created, f"walk create {class_id}/{subclass_id}")
    char = created.json()
    for level in range(2, 21):
        resp = await drivers.level_up_once(qa_client, qa_headers, char["id"], class_id,
                                           script.get(level, {}))
        oracles.assert_status_ok(resp, f"walk {class_id}/{subclass_id} L{level}")
        char = resp.json()
    return char


async def _hp(qa_client, qa_headers, char_id) -> int:
    sheet = await drivers.get_sheet(qa_client, qa_headers, char_id)
    oracles.assert_status_ok(sheet, f"sheet {char_id}")
    return sheet.json()["character"].get("hit_points_max")


@pytest.mark.parametrize("pair", REPS, ids=lambda p: f"{p.class_id}.{p.subclass_id}")
async def test_walk_matches_direct_build(qa_client, qa_headers, qa_user_id, pair):
    walked = await _walk_to_20(qa_client, qa_headers, qa_user_id, pair.class_id, pair.subclass_id)
    walked_hp = await _hp(qa_client, qa_headers, walked["id"])

    # build the same character directly at L20 with the canonical choices flattened
    script = build_choice_script(pair.class_id, pair.subclass_id)
    flat = {}
    for level_choices in script.values():
        flat.update(level_choices)
    flat.pop("subclass", None)  # subclass goes via subclass_id on the direct build
    built_resp = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, pair.class_id, level=20,
        subclass_id=pair.subclass_id, choices=flat or None)
    oracles.assert_status_ok(built_resp, f"build-at-20 {pair.class_id}/{pair.subclass_id}")
    built = built_resp.json()
    built_hp = await _hp(qa_client, qa_headers, built["id"])

    oracles.assert_walk_matches_build(walked, built, walked_hp=walked_hp, built_hp=built_hp,
                                      context=f"{pair.class_id}/{pair.subclass_id}")
