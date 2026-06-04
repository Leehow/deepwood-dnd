"""Phase 1 smoke breadth: every inline choice option lands without a 500.

A probe at level 1 is exercised through CREATE (you can't level *into* level 1); a
probe at a later level is exercised by creating at level-1 then leveling up once
choosing only that option.
"""
import pytest
from tests.qa_classes import drivers, oracles
from tests.qa_classes.generator import iter_inline_option_probes

pytestmark = [pytest.mark.asyncio]

PROBES = iter_inline_option_probes()


@pytest.mark.parametrize("probe", PROBES, ids=[p.label for p in PROBES])
async def test_inline_option_lands(qa_client, qa_headers, qa_user_id, probe):
    if probe.level <= 1:
        resp = await drivers.build_at_level(
            qa_client, qa_headers, qa_user_id, probe.class_id, level=1,
            choices={probe.fc_key: probe.option_id},
        )
        oracles.assert_status_ok(resp, f"create {probe.label}")
        char = resp.json()
    else:
        created = await drivers.build_at_level(
            qa_client, qa_headers, qa_user_id, probe.class_id, level=probe.level - 1)
        oracles.assert_status_ok(created, f"prereq build {probe.label}")
        resp = await drivers.level_up_once(
            qa_client, qa_headers, created.json()["id"], probe.class_id,
            {probe.fc_key: probe.option_id})
        oracles.assert_status_ok(resp, f"level-up {probe.label}")
        char = resp.json()
    oracles.assert_option_landed(char, probe.char_field, probe.option_id, probe.label)


async def test_level_up_ignores_unoffered_fighting_style(qa_client, qa_headers, qa_user_id):
    """Bug #2 (fixed): a fighter gets a fighting style at L1 only. Submitting one on the
    L1->L2 level-up (which offers none) must be IGNORED, not applied — the frontend gates
    choices, so a not-offered submission is a no-op here, never a 422. The L1 style stays."""
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=1,
        choices={"fighting_style": "archery"})
    assert created.status_code == 201, created.text
    lv2 = await drivers.level_up_once(
        qa_client, qa_headers, created.json()["id"], "fighter",
        {"fighting_style": "great_weapon_fighting"})
    assert lv2.status_code == 200, lv2.text
    assert not oracles.option_landed(lv2.json(), "fighting_style", "great_weapon_fighting"), \
        f"unoffered fighting_style should be ignored, got {lv2.json().get('fighting_style')!r}"
    assert oracles.option_landed(lv2.json(), "fighting_style", "archery"), \
        "the L1 fighting style should be unchanged"


async def test_champion_l10_fighting_style_is_offered(qa_client, qa_headers, qa_user_id):
    """Regression guard for the offering heuristic: Champion fighters DO get a second
    fighting style at L10 (a subclass FEATURE, not a top-level choice node), so the gate
    must still apply it — proving the gate isn't over-zealously ignoring valid picks."""
    created = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=9,
        subclass_id="champion", choices={"fighting_style": "archery"})
    assert created.status_code == 201, created.text
    lv10 = await drivers.level_up_once(
        qa_client, qa_headers, created.json()["id"], "fighter",
        {"fighting_style": "defense"})
    assert lv10.status_code == 200, lv10.text
    assert oracles.option_landed(lv10.json(), "fighting_style", "defense"), \
        f"champion L10 second fighting style should apply, got {lv10.json().get('fighting_style')!r}"
