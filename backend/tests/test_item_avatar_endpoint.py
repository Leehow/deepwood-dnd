"""Tests for POST /api/items/{id}/generate-avatar."""

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.campaign import Campaign
from app.models.item import Item
from app.api.routes.items import ItemAvatarGenRequest, generate_item_avatar, get_item
from app.models.user import User
from app.services.avatar_service import avatar_service


@pytest.mark.asyncio
async def test_item_generate_avatar_endpoint(
    db_session: AsyncSession,
    test_campaign: Campaign,
    test_dm: User,
    monkeypatch: pytest.MonkeyPatch,
):
    print("\n=== test_item_generate_avatar_endpoint: START ===")

    calls: list[dict] = []

    async def fake_generate_avatar(**kwargs):
        calls.append(kwargs)
        return "/images/items/test-avatar.png", "/images/items/test-avatar-large.png"

    monkeypatch.setattr(avatar_service, "generate_avatar", fake_generate_avatar)

    new_item = Item(
        campaign_id=test_campaign.id,
        name="Test Avatar Item",
        name_cn="单测物品",
        category="adventuring_gear",
        description="Unit test item for avatar generation",
        is_custom=True,
        weight=1.0,
    )
    db_session.add(new_item)
    await db_session.commit()
    await db_session.refresh(new_item)
    print(f"Created item: id={new_item.id}, has_avatar={new_item.has_avatar}, avatar_url={new_item.avatar_url}")

    current_user = {
        "user_id": str(test_dm.id),
        "email": test_dm.email,
        "role": test_dm.role,
        "display_name": test_dm.username,
    }

    print("Calling generate_item_avatar() ...")
    updated = await generate_item_avatar(
        new_item.id,
        db_session,
        body=ItemAvatarGenRequest(prompt_override="glowing backpack icon"),
        current_user=current_user,
    )
    print(f"Returned item: id={updated.id}, has_avatar={updated.has_avatar}, avatar_url={updated.avatar_url}")

    await db_session.refresh(new_item)
    print(f"DB refreshed item: id={new_item.id}, has_avatar={new_item.has_avatar}, avatar_url={new_item.avatar_url}")

    assert len(calls) == 1
    assert calls[0]["entity_type"] == "item"
    assert calls[0]["entity_id"] == new_item.id
    assert calls[0]["prompt_override"] == "glowing backpack icon"

    assert new_item.has_avatar is True, "has_avatar should be True after generation"
    assert new_item.avatar_url == "/images/items/test-avatar.png"
    assert new_item.avatar_url_large == "/images/items/test-avatar-large.png"

    got = await get_item(new_item.id, db_session)
    print(f"GET item: id={got.id}, has_avatar={got.has_avatar}, avatar_url={got.avatar_url}")
    assert got.has_avatar is True
    assert got.avatar_url == new_item.avatar_url

    print("=== test_item_generate_avatar_endpoint: END ===\n")

