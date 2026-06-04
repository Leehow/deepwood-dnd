import pytest
from httpx import AsyncClient

from app.core.config import settings
from app.services.qa import forced_roll


@pytest.mark.asyncio
async def test_forced_roll_404_when_qa_mode_off(client: AsyncClient, dm_auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", False)
    resp = await client.post("/api/qa/forced-roll", json={"rolls": [5]}, headers=dm_auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_forced_roll_queues_when_qa_mode_on(client: AsyncClient, dm_auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    forced_roll.clear_forced_rolls()
    resp = await client.post("/api/qa/forced-roll", json={"rolls": [5, 18]}, headers=dm_auth_headers)
    assert resp.status_code == 200
    assert resp.json()["queue_size"] == 2
    assert forced_roll.queue_size() == 2
    forced_roll.clear_forced_rolls()


@pytest.mark.asyncio
async def test_seed_reset_snapshot_endpoints(client: AsyncClient, dm_auth_headers, monkeypatch):
    monkeypatch.setattr(settings, "QA_MODE", True)
    seed_resp = await client.post("/api/qa/seed", headers=dm_auth_headers)
    assert seed_resp.status_code == 200
    body = seed_resp.json()
    cid = body["campaign_id"]
    assert cid > 0
    assert "qa_all_spells_caster" in body["actor_ids"]

    reset_resp = await client.post(
        "/api/qa/reset", json={"campaign_id": cid, "spell_id": "fireball"}, headers=dm_auth_headers)
    assert reset_resp.status_code == 200
    assert reset_resp.json()["reset"] >= 19

    snap_resp = await client.get(f"/api/qa/snapshot?campaign_id={cid}", headers=dm_auth_headers)
    assert snap_resp.status_code == 200
    assert len(snap_resp.json()["tokens"]) >= 19
