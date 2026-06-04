from unittest.mock import AsyncMock

import pytest

from app.models.token import Token


@pytest.mark.asyncio
async def test_update_token_hp_notifies_runtime_when_token_drops_to_zero(
    client,
    db_session,
    auth_headers,
    test_campaign,
    monkeypatch,
):
    token = Token(
        campaign_id=test_campaign.id,
        user_id="test-user",
        map_url="https://example.com/test-map.png",
        position_x=10,
        position_y=10,
        token_size="1x1",
        instance_name="Hex Target",
        current_hp=12,
        faction="enemy",
    )
    db_session.add(token)
    await db_session.commit()
    await db_session.refresh(token)

    notify_target_downed = AsyncMock(return_value=[token.id])
    publish_token_hp_updated = AsyncMock()

    monkeypatch.setattr(
        "app.api.routes.tokens.notify_target_downed",
        notify_target_downed,
    )
    monkeypatch.setattr(
        "app.api.routes.tokens.realtime_publisher.publish_token_hp_updated",
        publish_token_hp_updated,
    )

    response = await client.post(
        f"/api/tokens/{token.id}/hp",
        json={"current_hp": 0, "force": True},
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["current_hp"] == 0

    notify_target_downed.assert_awaited_once_with(
        db_session,
        campaign_id=test_campaign.id,
        target_token_id=token.id,
    )
    publish_token_hp_updated.assert_awaited_once()
