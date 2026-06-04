import pytest
from tests.qa_classes import drivers

pytestmark = [pytest.mark.asyncio]


async def test_build_at_level_creates_fighter(qa_client, qa_headers, qa_user_id):
    resp = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=1,
        choices={"fighting_style": "archery"},
    )
    assert resp.status_code == 201, resp.text
    char = resp.json()
    assert char["class_id"] == "fighter"
    assert char["level"] == 1
    assert char["id"]


async def test_level_up_and_sheet(qa_client, qa_headers, qa_user_id):
    created_resp = await drivers.build_at_level(
        qa_client, qa_headers, qa_user_id, "fighter", level=1)
    assert created_resp.status_code == 201, created_resp.text
    created = created_resp.json()
    lvl = await drivers.level_up_once(qa_client, qa_headers, created["id"], "fighter")
    assert lvl.status_code == 200, lvl.text
    assert lvl.json()["level"] == 2
    sheet = await drivers.get_sheet(qa_client, qa_headers, created["id"])
    assert sheet.status_code == 200, sheet.text
    assert "character" in sheet.json()
